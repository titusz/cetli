/**
 * Tests for the Python bridge script with the real interpreters: a TodoPaper
 * plugin written in Python 2 syntax runs unchanged under Python 2.7, and the
 * console runs code with `self` as the editor. Editor calls are answered by the
 * test, playing Cetli's part of the protocol. Skipped when no Python is found.
 */

import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const BRIDGE = join(process.cwd(), "src-tauri", "src", "python", "cetli_bridge.py");

/** A Python interpreter command for a major version, or null. */
function findPython(major: 2 | 3): string[] | null {
  const candidates = major === 2 ? [["py", "-2"], ["python2"]] : [["py", "-3"], ["python3"], ["python"]];
  for (const [cmd, ...args] of candidates) {
    const r = spawnSync(cmd, [...args, "-c", "import sys; sys.stdout.write(str(sys.version_info[0]))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === String(major)) return [cmd, ...args];
  }
  return null;
}

/** A Python interpreter with wxPython (CETLI_WX_PYTHON, else an installed one), or null. */
function findWxPython(): string[] | null {
  const own = process.env.CETLI_WX_PYTHON ? [[process.env.CETLI_WX_PYTHON]] : [];
  return [...own, ["py", "-2"], ["py", "-3"], ["python"]].find(([cmd, ...args]) => spawnSync(cmd, [...args, "-c", "import wx"]).status === 0) ?? null;
}

/** A plugin that creates a wxPython dialog (it needs a wx application). */
const WX_PLUGIN = `from Plugins import PluginProvider, menu_item
import wx

class Ask(PluginProvider):
    plugin_name = "Ask"

    @menu_item("Ask")
    def ask(self):
        dialog = wx.TextEntryDialog(None, "Task?", "Ask")
        dialog.Destroy()
        print(wx.GetApp() is not None)
`;

/** A running bridge process with a message queue. */
class Bridge {
  proc: ChildProcess;
  private queue: unknown[] = [];
  private waiting: ((m: any) => void) | null = null;
  private buffer = "";

  constructor(command: string[]) {
    this.proc = spawn(command[0], [...command.slice(1), "-u", BRIDGE], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    this.proc.stdout!.on("data", (d) => {
      this.buffer += String(d);
      let i: number;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (this.waiting) {
          const w = this.waiting;
          this.waiting = null;
          w(msg);
        } else this.queue.push(msg);
      }
    });
  }

  next(): Promise<any> {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve) => (this.waiting = resolve));
  }

  send(msg: unknown): void {
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }
}

const PY2_PLUGIN = `# A TodoPaper plugin, Python 2 syntax
from Plugins import PluginProvider, menu_item, mount_point

print "a stray print while loading must not reach the protocol channel"

class HelloPlugin(PluginProvider):
    plugin_name = "Hello"

    @menu_item("Add Greeting", "Ctrl+Alt+H")
    def add_greeting(self):
        editor = self.interface.get_current_editor()
        print "lines before:", editor.GetLineCount()
        editor.AddToProject(u"- hello from a TodoPaper plugin \\u2713", "Inbox", False)

@mount_point("on_start")
def started(plugin, frame):
    frame.activeEditor.GetLength()
`;

let bridge: Bridge | null = null;
afterEach(() => {
  bridge?.proc.kill();
  bridge = null;
});

/** Write a plugin file and return its path. */
function pluginFile(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cetli-py-"));
  const path = join(dir, "hello.todopaper.plugin.py");
  writeFileSync(path, source);
  return path;
}

describe("Python bridge", () => {
  const py2 = findPython(2);
  const py3 = findPython(3);

  test.runIf(!!py2)("runs a TodoPaper Python 2 plugin unchanged: menu items, editor calls, prints, on_start", async () => {
    bridge = new Bridge(py2!);
    expect((await bridge.next()).version).toMatch(/^2\.7/);
    bridge.send({ type: "load", files: [pluginFile(PY2_PLUGIN)] });
    const loaded = await bridge.next();
    expect(loaded.plugins).toEqual([{ index: 0, name: "Hello", path: expect.any(String), items: [{ label: "Add Greeting", key: "Ctrl+Alt+H" }] }]);

    bridge.send({ type: "run", plugin: 0, item: 0 });
    expect(await bridge.next()).toEqual({ type: "call", name: "GetLineCount", args: [] });
    bridge.send({ type: "result", value: 5 });
    expect(await bridge.next()).toEqual({ type: "call", name: "AddToProject", args: ["- hello from a TodoPaper plugin ✓", "Inbox", false] });
    bridge.send({ type: "result", value: null });
    expect(await bridge.next()).toEqual({ type: "done", output: "lines before: 5\n", error: null });

    bridge.send({ type: "mount", name: "on_start" });
    expect(await bridge.next()).toEqual({ type: "call", name: "GetLength", args: [] });
    bridge.send({ type: "result", value: 42 });
    expect((await bridge.next()).type).toBe("done");
  });

  test.runIf(!!py2)("console runs Python with self as the editor (TodoPaper's console)", async () => {
    bridge = new Bridge(py2!);
    await bridge.next();
    bridge.send({ type: "console", code: "print self.GetLineCount()" });
    expect(await bridge.next()).toEqual({ type: "call", name: "GetLineCount", args: [] });
    bridge.send({ type: "result", value: 7 });
    expect((await bridge.next()).output).toBe("7\nCommand completed successfully");
    bridge.send({ type: "console", code: "1/0" });
    expect((await bridge.next()).output).toContain("ZeroDivisionError");
    bridge.send({ type: "console", code: "self.NoSuchMethod()" });
    expect(await bridge.next()).toEqual({ type: "call", name: "NoSuchMethod", args: [] });
    bridge.send({ type: "result", error: "Editor method NoSuchMethod is not available in Cetli" });
    expect((await bridge.next()).output).toContain("is not available in Cetli");
  });

  test.runIf(!!py3)("works with Python 3 too, and reports broken plugin files", async () => {
    bridge = new Bridge(py3!);
    expect((await bridge.next()).version).toMatch(/^3\./);
    const good = pluginFile(PY2_PLUGIN.replace(/print "(.*)"(, editor.GetLineCount\(\))?/g, 'print("$1"$2)'));
    const bad = pluginFile("def broken(:\n");
    bridge.send({ type: "load", files: [good, bad] });
    const loaded = await bridge.next();
    expect(loaded.plugins[0].name).toBe("Hello");
    expect(loaded.plugins[1].error).toMatch(/SyntaxError/);
  });

  for (const [major, python] of [[2, py2], [3, py3]] as const) {
    test.runIf(!!python)(`loads compiled *.todopaper.plugin files like TodoPaper (Python ${major})`, async () => {
      const source = pluginFile(major === 2 ? PY2_PLUGIN : PY2_PLUGIN.replace(/print "(.*)"(, editor.GetLineCount\(\))?/g, 'print("$1"$2)'));
      const compiled = source.replace(/\.py$/, "");
      const compile = "import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)";
      expect(spawnSync(python![0], [...python!.slice(1), "-c", compile, source, compiled]).status).toBe(0);
      // TodoPaper's own compiled plugins are Python 2.5 bytecode (magic number 62131)
      const old = join(dirname(source), "old.todopaper.plugin");
      writeFileSync(old, Buffer.concat([Buffer.from([0xb3, 0xf2, 0x0d, 0x0a]), Buffer.alloc(24)]));
      bridge = new Bridge(python!);
      await bridge.next();
      bridge.send({ type: "load", files: [compiled, old] });
      const loaded = await bridge.next();
      expect(loaded.plugins[0]).toMatchObject({ name: "Hello", items: [{ label: "Add Greeting", key: "Ctrl+Alt+H" }] });
      expect(loaded.plugins[1].error).toBe(
        "ImportError: old.todopaper.plugin was compiled for another Python version (TodoPaper used Python 2.5); use the plugin's .py source",
      );
    });
  }

  const wx = findWxPython();
  test.runIf(!!wx)("plugins using wxPython get a wx application, so their dialogs work", async () => {
    bridge = new Bridge(wx!);
    await bridge.next();
    bridge.send({ type: "load", files: [pluginFile(WX_PLUGIN)] });
    expect((await bridge.next()).plugins[0]).toMatchObject({ name: "Ask", items: [{ label: "Ask" }] });
    bridge.send({ type: "run", plugin: 0, item: 0 });
    expect(await bridge.next()).toEqual({ type: "done", output: "True\n", error: null });
  });
});
