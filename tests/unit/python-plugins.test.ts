/**
 * Tests for TodoPaper's Python plugin API in Cetli: Scintilla positions (UTF-8
 * bytes, file line endings), the editor methods plugins call, the helpers of
 * the Python host, and a TodoPaper plugin running in the real Python 2.7 bridge
 * against a real editor state (everything but the desktop shell's pipe).
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { byteLength, byteToPos, lineStartByte, posToByte, utf8Length } from "../../src/core/scintilla";
import { EditorHost, editorCall, editorMethodNames } from "../../src/app/pyeditor";
import { PythonHost, asciiJson, exceptionLine, isPythonPlugin, wxKey } from "../../src/app/python";
import type { Platform, PythonProcess } from "../../src/platform/platform";
import { mk } from "./helpers";

/** An editor host over a plain editor state, recording actions and watched tags. */
function host(doc: string, eol = "\r\n") {
  let state = mk(doc);
  const log: string[] = [];
  const h: EditorHost = {
    state: () => state,
    dispatch: (spec) => (state = state.update(spec).state),
    eol: () => eol,
    runAction: (id) => log.push(id),
    setSearch: (q) => log.push(`search:${q}`),
    save: async () => log.push("save"),
    watchTag: (t) => log.push(`watch:${t}`),
    unwatchTag: (t) => log.push(`unwatch:${t}`),
  };
  const call = (name: string, ...args: unknown[]) => editorCall(h, name, args);
  return { h, log, call, text: () => state.doc.toString(), state: () => state };
}

describe("Scintilla positions", () => {
  const doc = Text.of(["Grüße:", "- Bär 😀 @today", "- end"]);

  test("UTF-8 lengths", () => {
    expect(utf8Length("aä€😀")).toBe(1 + 2 + 3 + 4);
    expect(utf8Length("")).toBe(0);
  });

  test("line starts and lengths count line endings and UTF-8 bytes", () => {
    expect(lineStartByte(doc, 0, "\r\n")).toBe(0);
    expect(lineStartByte(doc, 1, "\r\n")).toBe(utf8Length("Grüße:") + 2);
    expect(lineStartByte(doc, 1, "\n")).toBe(utf8Length("Grüße:") + 1);
    expect(byteLength(doc, "\r\n")).toBe(utf8Length("Grüße:\r\n- Bär 😀 @today\r\n- end"));
  });

  test("positions convert both ways", () => {
    for (let pos = 0; pos <= doc.length; pos++) {
      const line = doc.lineAt(pos);
      const inSurrogate = /[\udc00-\udfff]/.test(line.text[pos - line.from] ?? "");
      if (!inSurrogate) expect(byteToPos(doc, posToByte(doc, pos, "\r\n"), "\r\n")).toBe(pos);
    }
    expect(byteToPos(doc, utf8Length("Grüße:") + 1, "\r\n")).toBe(doc.line(1).to); // inside CRLF
    expect(byteToPos(doc, 99999, "\r\n")).toBe(doc.length);
    expect(byteToPos(doc, -5, "\r\n")).toBe(0);
  });
});

describe("plugin editor methods", () => {
  test("text and lines as TodoPaper's editor returned them (CRLF, 0-based lines)", () => {
    const { call } = host("Inbox:\n- Bär\n- end");
    expect(call("GetText")).toBe("Inbox:\r\n- Bär\r\n- end");
    expect(call("GetLineCount")).toBe(3);
    expect(call("GetLine", 1)).toBe("- Bär\r\n");
    expect(call("GetLine", 2)).toBe("- end");
    expect(call("getLineText", 1)).toBe("- Bär");
    expect(call("LineLength", 1)).toBe(utf8Length("- Bär\r\n"));
    expect(call("GetLength")).toBe(utf8Length("Inbox:\r\n- Bär\r\n- end"));
  });

  test("byte positions: lines, selection, ranges and insertion", () => {
    const t = host("Inbox:\n- Bär\n- end");
    const start1 = utf8Length("Inbox:\r\n");
    expect(t.call("PositionFromLine", 1)).toBe(start1);
    expect(t.call("GetLineEndPosition", 1)).toBe(start1 + utf8Length("- Bär"));
    expect(t.call("getLineSpan", 1)).toEqual([start1, start1 + utf8Length("- Bär")]);
    expect(t.call("LineFromPosition", start1 + 3)).toBe(1);
    t.call("SetSelection", start1 + 2, start1 + utf8Length("- Bär"));
    expect(t.call("GetSelectedText")).toBe("Bär");
    expect(t.call("GetSelection")).toEqual([start1 + 2, start1 + utf8Length("- Bär")]);
    expect(t.call("GetCurrentLine")).toBe(1);
    expect(t.call("GetTextRange", 0, 5)).toBe("Inbox");
    t.call("InsertText", t.call("GetLineEndPosition", 1), " @home");
    expect(t.text()).toBe("Inbox:\n- Bär @home\n- end");
    t.call("GotoLine", 2);
    t.call("AddText", "x");
    expect(t.text()).toBe("Inbox:\n- Bär @home\nx- end");
    expect(t.call("GetCurLine")).toEqual(["x- end", 1]);
    t.call("ReplaceSelection", "Line1\r\nLine2 ");
    expect(t.text()).toBe("Inbox:\n- Bär @home\nxLine1\nLine2 - end");
  });

  test("TodoPaper line helpers", () => {
    const t = host("Home:\n\t- one\n\t- two");
    expect(t.call("insertLine", 1, "- new")).toBe(2);
    expect(t.text()).toBe("Home:\n\t- one\n\t- new\n\t- two");
    expect(t.call("insertLine", 0, "Top:", true)).toBe(0);
    t.call("replaceLine", 0, "First:");
    t.call("deleteLine", 2);
    expect(t.text()).toBe("First:\nHome:\n\t- new\n\t- two");
    t.call("SetSelection", 0, t.call("PositionFromLine", 2));
    expect(t.call("getSelectedLines")).toEqual([0, 1, 2]);
    expect(t.call("GetIndentLevel", 2)).toBe(1);
    expect(t.call("getProjectNameFromLine", 1)).toBe("Home");
    expect(t.call("getProjectNameFromLine", 2)).toBe(null);
    expect([t.call("isLineTitle", 1), t.call("isLineTask", 2)]).toEqual([true, true]);
    expect(t.call("getAllProjects")).toEqual([["First", 0, 0], ["Home", utf8Length("First:\r\n"), 0]]);
  });

  test("AddToProject, AddToInbox (as tasks unless makeTask is false) and tags", () => {
    const t = host("Home:\n- one");
    t.call("AddToProject", "two", "Home");
    editorCall(t.h, "AddToProject", ["- three", "Home"], { makeTask: false });
    t.call("AddToInbox", "call Bob");
    expect(t.text()).toBe("Inbox:\n- call Bob\nHome:\n- one\n- two\n- three");
    t.call("markTag", 3, "today");
    expect(t.text()).toContain("- one @today");
    t.call("toggleTag", 3, "@today");
    expect(t.text()).toContain("- one\n");
    expect(t.call("getAllTags")).toEqual(["@done", "@home", "@today", "@work"]);
    expect(t.call("GetInboxName")).toBe("Inbox");
  });

  test("TodoPaper commands run Cetli actions", async () => {
    const t = host("Home:\n- one");
    for (const name of ["tagDone", "insertProject", "ArchiveDoneTasks", "toggleDoneTasks", "SearchReset"]) t.call(name);
    t.call("tagPriority", 3);
    t.call("MoveCurrentLineUp");
    editorCall(t.h, "MoveCurrentLineDown", [], { group: true });
    t.call("ShowAllFolds", false);
    t.call("Search", "@today");
    await t.call("Save");
    t.call("tag_register_callback", "@today");
    expect(t.log).toEqual(["tagDone", "newProject", "archiveDone", "hideDone", "resetSearch", "priority3", "moveUp", "moveTreeDown", "collapseAll", "search:@today", "save", "watch:@today"]);
  });

  test("unknown methods and keyword arguments fail like Python would", () => {
    const t = host("x");
    expect(() => t.call("NoSuchMethod")).toThrow("Editor method NoSuchMethod is not available in Cetli");
    expect(() => editorCall(t.h, "AddToProject", ["a", "b"], { make_task: false })).toThrow("unexpected keyword argument 'make_task'");
    expect(() => t.call("constructor")).toThrow("not available");
    expect(editorMethodNames()).toContain("GetCurrentPos");
  });
});

describe("Python host helpers", () => {
  test("TodoPaper (wxWidgets) accelerators become key names", () => {
    expect(wxKey("Ctrl+Alt+H")).toBe("Mod-Alt-h");
    expect(wxKey("Ctrl+Shift+PgDn")).toBe("Mod-Shift-PageDown");
    expect(wxKey("F5")).toBe("F5");
    expect(wxKey("")).toBeUndefined();
    expect(wxKey(undefined)).toBeUndefined();
  });

  test("messages to Python are plain ASCII", () => {
    const line = asciiJson({ text: "Bär 😀 ✓", n: 1 });
    expect(line).toMatch(/^[ -~]+$/);
    expect(JSON.parse(line)).toEqual({ text: "Bär 😀 ✓", n: 1 });
  });

  test("other helpers", () => {
    expect(exceptionLine("Traceback (most recent call last):\n  File x\nZeroDivisionError: division by zero\n")).toBe("ZeroDivisionError: division by zero");
    expect([isPythonPlugin("a.todopaper.plugin.py"), isPythonPlugin("a.js")]).toEqual([true, false]);
  });
});

/** The installed interpreter command for a Python major version, or null. */
function pythonOf(major: 2 | 3): string[] | null {
  const candidates = major === 2 ? [["py", "-2"], ["python2"]] : [["py", "-3"], ["python3"], ["python"]];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd, [...args, "-c", "import sys; sys.stdout.write(str(sys.version_info[0]))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout === String(major)) return [cmd, ...args];
  }
  return null;
}

/** A platform whose startPython spawns the bridge script directly. */
function bridgePlatform(command: string[]): Platform {
  const script = join(process.cwd(), "src-tauri", "src", "python", "cetli_bridge.py");
  return {
    async startPython(onLine: (line: string) => void, onExit: () => void): Promise<PythonProcess> {
      const proc = spawn(command[0], [...command.slice(1), "-u", script], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      let buffer = "";
      proc.stdout.on("data", (d) => {
        buffer += String(d);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.filter((l) => l.trim()).forEach((l) => onLine(l.trim()));
      });
      proc.on("exit", onExit);
      return { interpreter: command.join(" "), send: async (line) => void proc.stdin.write(line + "\n"), stop: async () => void proc.kill() };
    },
  } as unknown as Platform;
}

const TODOPAPER_PLUGIN = `# -*- coding: utf-8 -*-
# A TodoPaper 1.1.5 plugin (Python 2 syntax, TodoPaper's Plugins module and editor methods)
from Plugins import PluginProvider, menu_item, mount_point

def on_today(editor, line, tag, deleted=False):
    if not deleted:
        editor.AddToProject(u"saw %s on line %d" % (tag, line), "Log")

class Tidy(PluginProvider):
    plugin_name = "Tidy"

    @menu_item("Mark Selected Lines", "Ctrl+Alt+M")
    def mark(self):
        editor = self.interface.get_current_editor()
        for line in editor.getSelectedLines():
            end = editor.GetLineEndPosition(line)
            editor.InsertText(end, u" @gr\\xfc\\xdfe")
        print "marked", len(editor.getSelectedLines())

    @menu_item("Broken")
    def broken(self):
        raise ValueError(u"nothing to do")

@mount_point("on_start")
def started(plugin, frame):
    frame.activeEditor.tag_register_callback("@today", on_today)
`;

describe("the documented example plugin", () => {
  const example = join(process.cwd(), "docs", "plugins", "insert-timestamp.todopaper.plugin.py");

  for (const major of [2, 3] as const) {
    const command = pythonOf(major);
    test.runIf(!!command)(`runs with Python ${major}`, async () => {
      const t = host("Work:\n- report\n- call Bob");
      const python = await PythonHost.start(bridgePlatform(command!), (name, args, kwargs) => editorCall(t.h, name, args, kwargs));
      try {
        const [report] = await python.load([example]);
        expect(report).toMatchObject({ name: "Timestamp", items: [{ label: "Insert Timestamp", key: "Ctrl+Alt+D" }, { label: "Tag Selected Lines @review" }] });
        editorCall(t.h, "SetSelection", [utf8Length("Work:\r\n"), utf8Length("Work:\r\n- report\r\n- c")]);
        expect((await python.run(report.index, 1)).error).toBe(null);
        expect((await python.run(report.index, 1)).error).toBe(null);
        expect(t.text()).toBe("Work:\n- report @review\n- call Bob @review");
        editorCall(t.h, "GotoLine", [0]);
        expect((await python.run(report.index, 0)).error).toBe(null);
        expect(t.text()).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\dWork:\n/);
      } finally {
        await python.stop();
      }
    });
  }
});

describe("TodoPaper plugin in the Python 2.7 bridge", () => {
  const py2 = pythonOf(2);

  test.runIf(!!py2)("menu items edit the document through Scintilla positions; on_start, tag callbacks and the console work", async () => {
    const t = host("Home:\n- Bär\n- two");
    const dir = mkdtempSync(join(tmpdir(), "cetli-py-"));
    const file = join(dir, "tidy.todopaper.plugin.py");
    writeFileSync(file, TODOPAPER_PLUGIN, "utf8");
    const python = await PythonHost.start(bridgePlatform(py2!), (name, args, kwargs) => editorCall(t.h, name, args, kwargs));
    try {
      expect(python.description).toMatch(/^Python 2\.7\.\d+ \(/);
      const [report] = await python.load([file]);
      expect(report).toMatchObject({ name: "Tidy", items: [{ label: "Mark Selected Lines", key: "Ctrl+Alt+M" }, { label: "Broken", key: "" }] });

      editorCall(t.h, "SetSelection", [utf8Length("Home:\r\n"), utf8Length("Home:\r\n- Bär\r\n- t")]);
      expect(await python.run(report.index, 0)).toEqual({ type: "done", output: "marked 2\n", error: null });
      expect(t.text()).toBe("Home:\n- Bär @grüße\n- two @grüße");

      const broken = await python.run(report.index, 1);
      expect(exceptionLine(broken.error ?? "")).toBe("ValueError: nothing to do");

      expect((await python.mount("on_start")).error).toBe(null);
      expect(t.log).toContain("watch:@today");
      expect((await python.tag("@today", 1, false)).error).toBe(null);
      expect(t.text()).toBe("Log:\n- saw @today on line 1\nHome:\n- Bär @grüße\n- two @grüße");

      expect(await python.console("print self.GetLineCount()")).toBe("5\nCommand completed successfully");
      expect(await python.console("self.Nope()")).toContain("Editor method Nope is not available in Cetli");
    } finally {
      await python.stop();
    }
  });

  test.runIf(!!py2)("stopping the bridge ends a running request instead of leaving it waiting", async () => {
    const t = host("x");
    const python = await PythonHost.start(bridgePlatform(py2!), (name, args, kwargs) => editorCall(t.h, name, args, kwargs));
    const running = python.console("import time\ntime.sleep(10)");
    await new Promise((r) => setTimeout(r, 200));
    await python.stop();
    expect(await running).toBe("Python was stopped");
    expect(await python.console("print 1")).toBe("Python is not running");
  });
});
