/**
 * End-to-end tests of the real Cetli desktop app (Tauri + WebView2): saving to
 * disk with preserved line endings, TodoPaper backup autosave, external change
 * reload, the quick log window and native global hotkey, real keystrokes,
 * window transparency, dropped-file paths, plugins from the plugins folder
 * (JavaScript, and TodoPaper Python plugins in the installed Python) and
 * multiple document windows.
 */

import { Browser, Page, chromium, expect, test } from "@playwright/test";
import { ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXE = join(process.cwd(), "src-tauri", "target", "debug", "cetli.exe");
const PORT = 9333;
const DOC = "Inbox:\r\n- first task @today\r\n- second task\r\n\r\nWork:\r\n- report\r\n";

let app: ChildProcess;
let browser: Browser;
let page: Page;
let dir: string;
let file: string;

// A TodoPaper 1.1.5 plugin: Python 2 syntax, TodoPaper's Plugins module and editor methods
const PYTHON_PLUGIN = `# -*- coding: utf-8 -*-
from Plugins import PluginProvider, menu_item, mount_point

def on_tag(editor, line, tag, deleted=False):
    if not deleted:
        editor.AddToProject(u"tag added on line %d" % line, "Log")

class Tidy(PluginProvider):
    plugin_name = "Tidy"

    @menu_item("Mark Current Line", "Ctrl+Alt+M")
    def mark(self):
        editor = self.interface.get_current_editor()
        line = editor.GetCurrentLine()
        editor.InsertText(editor.GetLineEndPosition(line), u" @grüße")

    @menu_item("Mark Two Lines")
    def mark_two(self):
        editor = self.interface.get_current_editor()
        editor.BeginUndoAction()
        for line in (0, 1):
            editor.InsertText(editor.GetLineEndPosition(line), u" @x")
        editor.EndUndoAction()

@mount_point("on_start")
def started(plugin, frame):
    frame.activeEditor.tag_register_callback("@cetlitest", on_tag)
`;

/** True when a Python interpreter Cetli can use is installed. */
function hasPython(): boolean {
  const candidates = [["py", "-2"], ["python2"], ["py", "-3"], ["python3"], ["python"]];
  return candidates.some(([cmd, ...args]) => spawnSync(cmd, [...args, "-c", "import json"]).status === 0);
}

// Development builds (tauri.dev.conf.json) use their own identifier, so tests never touch an installed Cetli
const CONFIG =join(process.env.APPDATA ?? "", "org.cetli.dev");
const CONFIG_BACKUP = CONFIG + ".test-backup";

/** Wait until the WebView2 debugging endpoint answers. */
async function waitForCdp(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("WebView2 debugging endpoint did not come up");
}

/** Find the page of a window by URL predicate. */
async function findPage(pred: (url: string) => boolean): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (pred(p.url())) return p;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("page not found");
}

/** Current document text in the app. */
const docText = () => page.evaluate(() => (window as any).cetli.view.state.doc.toString());

/** Bring the window with the given title to the front and click into the editor, like a user would. */
function clickIntoApp(title: string): void {
  const api = [
    '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);',
    '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
    "public struct RECT { public int L, T, R, B; }",
  ].join(" ");
  const ps = `Add-Type -Name F -Namespace '' -MemberDefinition '${api}'; $h = [F]::FindWindow([NullString]::Value, '${title}'); if ($h -eq [IntPtr]::Zero) { throw 'window not found' }; [F]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 300; $r = New-Object F+RECT; [F]::GetWindowRect($h, [ref]$r) | Out-Null; [F]::SetCursorPos([int](($r.L + $r.R) / 2), [int]($r.T + 200)) | Out-Null; [F]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [F]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps]);
}

/** Read a window's layered alpha (null when the window is not layered). */
function windowAlpha(title: string): number | null {
  const api = [
    '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);',
    '[DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr h, out uint k, out byte a, out uint f);',
  ].join(" ");
  const ps = `Add-Type -Name L -Namespace '' -MemberDefinition '${api}'; $h = [L]::FindWindow([NullString]::Value, '${title}'); $k = 0; $a = 0; $f = 0; if ([L]::GetLayeredWindowAttributes($h, [ref]$k, [ref]$a, [ref]$f)) { $a } else { 'none' }`;
  const out = execFileSync("powershell", ["-NoProfile", "-Command", ps]).toString().trim();
  return out === "none" ? null : Number(out);
}

/** Press keys system-wide (Windows keybd_event) to exercise global hotkeys. */
function systemKeys(vks: number[]): void {
  const sc = (vk: number) => `[byte][K]::MapVirtualKey(${vk},0)`;
  const down = vks.map((vk) => `[K]::keybd_event(${vk},${sc(vk)},0,[UIntPtr]::Zero);`).join("");
  const up = [...vks].reverse().map((vk) => `[K]::keybd_event(${vk},${sc(vk)},2,[UIntPtr]::Zero);`).join("");
  const api = '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);';
  const ps = `Add-Type -Name K -Namespace '' -MemberDefinition '${api}'; ${down} Start-Sleep -Milliseconds 80; ${up}`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps]);
}

test.skip(process.platform !== "win32" || !existsSync(EXE), "desktop tests need Windows and a debug build");

test.beforeAll(async () => {
  if (existsSync(CONFIG) && !existsSync(CONFIG_BACKUP)) renameSync(CONFIG, CONFIG_BACKUP);
  mkdirSync(join(CONFIG, "plugins"), { recursive: true });
  writeFileSync(
    join(CONFIG, "plugins", "hello.js"),
    `export const name = "Hello";\nexport default function (cetli) {\n  cetli.addMenuItem("Say Hello", () => cetli.addToProject("- hello from a plugin", "Inbox"));\n}\n`,
  );
  writeFileSync(join(CONFIG, "plugins", "tidy.todopaper.plugin.py"), PYTHON_PLUGIN);
  dir = mkdtempSync(join(tmpdir(), "cetli-desktop-"));
  file = join(dir, "todo.txt");
  writeFileSync(file, DOC);
  app = spawn(EXE, [file], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" });
  await waitForCdp();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  page = await findPage((u) => !u.includes("window=quicklog") && /tauri|localhost/.test(u));
  await expect.poll(() => page.evaluate(() => !!(window as any).cetli?.path), { timeout: 15000 }).toBe(true);
  // most tests check the file on disk: save it directly and reload external changes silently
  await page.evaluate(() => {
    const app = (window as any).cetli;
    Object.assign(app.settings, { autoSaveMode: "file", reloadSilently: true });
    app.applySettings();
  });
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  app?.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true });
  rmSync(CONFIG, { recursive: true, force: true });
  if (existsSync(CONFIG_BACKUP)) renameSync(CONFIG_BACKUP, CONFIG);
});

test("opens the file given on the command line", async () => {
  expect(await docText()).toBe(DOC.replace(/\r\n/g, "\n"));
  const title = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|title", { label: "main" }));
  expect(title).toBe("todo.txt - Cetli");
});

test("edits are autosaved to disk with CRLF line endings preserved", async () => {
  await page.evaluate(() => {
    const view = (window as any).cetli.view;
    const line = view.state.doc.line(3);
    view.dispatch({ selection: { anchor: line.to } });
    view.focus();
  });
  await page.keyboard.type(" now");
  await page.keyboard.press("Control+d");
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: 8000 }).toMatch(/- second task now @done\(\d{4}-\d{2}-\d{2}\)\r\n\r\nWork:/);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
  expect(readFileSync(file, "utf8").split("\r\n").length).toBe(DOC.split("\r\n").length);
  expect(readFileSync(file, "utf8").replace(/\r\n/g, "")).not.toContain("\n");
});

test("changes made by other programs are reloaded", async () => {
  await new Promise((r) => setTimeout(r, 1200));
  writeFileSync(file, "Changed:\r\n- from outside\r\n");
  await expect.poll(docText, { timeout: 10000 }).toBe("Changed:\n- from outside\n");
});

test("quick log window logs into the inbox", async () => {
  await page.evaluate(() => (window as any).cetli.openQuickLog());
  const ql = await findPage((u) => u.includes("window=quicklog"));
  await expect(ql.locator(".quicklog-text")).toBeVisible();
  await ql.locator(".quicklog-text").focus();
  await ql.keyboard.type("call the plumber");
  await ql.keyboard.press("Enter");
  await expect.poll(docText, { timeout: 5000 }).toContain("Inbox:\n- call the plumber\n");
  await expect.poll(() => readFileSync(file, "utf8"), { timeout: 8000 }).toContain("Inbox:\r\n- call the plumber\r\n");
});

test("native global hotkey on the ISO <> key opens the quick log", async () => {
  // Ctrl+Shift+<: same native code path as TodoPaper's Ctrl+< (which TodoPaper itself may still hold)
  await page.evaluate(async () => {
    const app = (window as any).cetli;
    app.settings.quickLog = true;
    app.settings.quickLogShortcut = "CommandOrControl+Shift+IntlBackslash";
    await app.registerHotkey();
  });
  const visible = () =>
    page.evaluate(async () => {
      return (window as any).__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "quicklog" });
    });
  const ql = await findPage((u) => u.includes("window=quicklog"));
  await ql.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|hide", { label: "quicklog" }));
  await expect.poll(visible).toBe(false);
  systemKeys([0x11, 0x10, 0xe2]); // VK_CONTROL + VK_SHIFT + VK_OEM_102
  await expect.poll(visible, { timeout: 5000 }).toBe(true);
  await ql.keyboard.press("Escape");
});

test("real keystrokes reach Cetli (not WebView2 browser shortcuts), also after Quick Log was used", async () => {
  // regression: activating another Cetli window must not break keyboard input in the main window
  await page.evaluate(() => (window as any).cetli.openQuickLog());
  const ql = await findPage((u) => u.includes("window=quicklog"));
  await expect(ql.locator(".quicklog-text")).toBeVisible();
  await ql.keyboard.press("Escape");
  const title = await page.evaluate(async () => {
    (window as any).__marker = 42;
    (window as any).cetli.setSearch("@today");
    return (window as any).__TAURI_INTERNALS__.invoke("plugin:window|title", { label: "main" });
  });
  clickIntoApp(title);
  await new Promise((r) => setTimeout(r, 400));
  systemKeys([0x11, 0x52]); // Ctrl+R: Cetli resets the search; the browser would reload the page
  await expect.poll(() => page.evaluate(() => (window as any).cetli.tabs[0].query), { timeout: 5000 }).toBe("");
  expect(await page.evaluate(() => (window as any).__marker)).toBe(42);
  systemKeys([0x11, 0x48]); // Ctrl+H: hide done tasks (the browser would open history)
  await expect.poll(() => page.evaluate(() => (window as any).cetli.tabs[0].query), { timeout: 5000 }).toBe("NOT @done");
  systemKeys([0x11, 0x52]);
  const before = await docText();
  systemKeys([0x11, 0x50]); // Ctrl+P: new project (the browser would open the print dialog)
  await expect.poll(docText, { timeout: 5000 }).toContain("New Project:");
  expect((await docText()).length).toBe(before.length + "New Project:".length + 1);
  systemKeys([0x11, 0x5a]); // Ctrl+Z
  await expect.poll(docText, { timeout: 5000 }).toBe(before);
  systemKeys([0x11, 0x46]); // Ctrl+F: Cetli's find panel, not the browser find bar
  await expect(page.locator(".cm-search")).toBeVisible();
  systemKeys([0x1b]);
  expect(await page.evaluate(() => (window as any).__marker)).toBe(42);
});

test("the Quick Log hotkey is taken over when the program holding it exits (like a running TodoPaper)", async () => {
  // another process holds Ctrl+Shift+F11 for a few seconds, the way a running TodoPaper holds Ctrl+<
  const api = '[DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint m, uint vk); [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);';
  const script = `Add-Type -Name H -Namespace '' -MemberDefinition '${api}'; if ([H]::RegisterHotKey([IntPtr]::Zero, 7, 6, 0x7A)) { 'held' } else { 'failed' }; Start-Sleep -Seconds 8; [H]::UnregisterHotKey([IntPtr]::Zero, 7) | Out-Null`;
  const holder = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "ignore"] });
  const held = await new Promise<string>((resolve) => holder.stdout!.on("data", (d) => resolve(String(d).trim())));
  expect(held).toBe("held");
  await page.evaluate(async () => {
    const app = (window as any).cetli;
    app.settings.quickLogShortcut = "CommandOrControl+Shift+F11";
    await app.registerHotkey();
  });
  const visible = () => page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "quicklog" }));
  const hide = () => page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|hide", { label: "quicklog" }));
  await hide();
  systemKeys([0x11, 0x10, 0x7a]);
  await new Promise((r) => setTimeout(r, 800));
  expect(await visible()).toBe(false); // still held by the other program
  await new Promise<void>((resolve) => holder.on("exit", () => resolve()));
  await expect
    .poll(
      async () => {
        systemKeys([0x11, 0x10, 0x7a]);
        await new Promise((r) => setTimeout(r, 400));
        return visible();
      },
      { timeout: 30000, intervals: [1500] },
    )
    .toBe(true);
  await hide();
});

test("TodoPaper autosave writes a backup copy next to the file", async () => {
  const backup = join(dir, "todo (autosave).txt");
  await page.evaluate(() => {
    const app = (window as any).cetli;
    Object.assign(app.settings, { autoSaveMode: "backup", autoSaveInterval: 1 });
    app.applySettings();
    app.view.dispatch({ changes: { from: 0, insert: "Backup me:\n" } });
  });
  await expect.poll(() => existsSync(backup) && readFileSync(backup, "utf8"), { timeout: 8000 }).toContain("Backup me:\r\n");
  expect(readFileSync(file, "utf8")).not.toContain("Backup me:");
  await page.evaluate(() => (window as any).cetli.save());
  expect(readFileSync(file, "utf8")).toContain("Backup me:\r\n");
  expect(existsSync(backup)).toBe(true); // TodoPaper removes the backup when the file is closed
  await page.evaluate(() => {
    const app = (window as any).cetli;
    Object.assign(app.settings, { autoSaveMode: "file" });
    app.applySettings();
  });
});

test("window transparency makes the native window translucent (Ctrl+Shift+9 / 8)", async () => {
  const title = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|title", { label: "main" }));
  await page.evaluate(() => (window as any).cetli.changeOpacity(-30));
  await expect.poll(() => windowAlpha(title)).toBe(225);
  await page.evaluate(() => (window as any).cetli.changeOpacity(0));
  await expect.poll(() => windowAlpha(title)).toBeNull();
});

test("files dropped onto the editor become file:/// links with their real paths", async () => {
  const dropped = join(dir, "drop me.txt");
  writeFileSync(dropped, "x");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "test-files";
    document.body.appendChild(input);
  });
  // set the input through the DevTools protocol so the File objects are backed by the real files on disk
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#test-files" });
  await cdp.send("DOM.setFileInputFiles", { nodeId, files: [dropped] });
  await page.evaluate(() => {
    const app = (window as any).cetli;
    const files = (document.getElementById("test-files") as HTMLInputElement).files!;
    app.platform.dropFiles(files, app.view.state.doc.line(1).to);
  });
  const expected = "file:///" + dropped.replace(/\\/g, "/").replace(/ /g, "%20");
  await expect.poll(docText, { timeout: 5000 }).toContain(expected);
});

/** Loaded plugins as "name:menu items:error". */
const pluginList = () => page.evaluate(() => (window as any).cetli.plugins.map((p: any) => `${p.name}:${p.items.length}:${p.error ?? ""}`));

test("plugins from the plugins folder add menu items", async () => {
  await expect.poll(async () => (await pluginList())[0]).toBe("Hello:1:");
  await page.evaluate(() => (window as any).cetli.plugins[0].items[0].run());
  await expect.poll(docText).toContain("- hello from a plugin");
});

test("TodoPaper Python plugins run in the installed Python: menu item, on_start tag callback, Python console", async () => {
  test.skip(!hasPython(), "Python is not installed");
  await expect.poll(pluginList, { timeout: 15000 }).toEqual(["Hello:1:", "Tidy:2:"]);
  // edits between BeginUndoAction and EndUndoAction are one undo step, as in TodoPaper
  const text = () => page.evaluate(() => (window as any).cetli.view.state.doc.toString());
  const original = await text();
  await page.evaluate(() => (window as any).cetli.plugins[1].items[1].run());
  await expect.poll(text).toMatch(/^[^\n]* @x\n[^\n]* @x\n/);
  await page.evaluate(() => (window as any).cetli.undo());
  expect(await text()).toBe(original);
  // the menu item appends a tag to the current line through Scintilla byte positions
  await page.evaluate(() => {
    const app = (window as any).cetli;
    app.view.dispatch({ selection: { anchor: app.view.state.doc.line(2).from } });
    app.plugins[1].items[0].run();
  });
  const line = (n: number) => page.evaluate((n) => (window as any).cetli.view.state.doc.line(n).text, n);
  await expect.poll(() => line(2)).toMatch(/ @grüße$/);
  // the callback registered in on_start sees the tag being added (0-based line number, as in TodoPaper)
  const lineCount = () => page.evaluate(() => (window as any).cetli.view.state.doc.lines);
  const before = await lineCount();
  await page.evaluate(() => {
    const app = (window as any).cetli;
    app.view.dispatch({ changes: { from: app.view.state.doc.line(3).to, insert: " @cetlitest" } });
  });
  await expect.poll(() => line(1)).toBe("Log:");
  expect(await line(2)).toBe("- tag added on line 2");
  await new Promise((r) => setTimeout(r, 300));
  expect(await lineCount()).toBe(before + 2); // "Log:" and one item: the callback ran once
  // the console runs Python with self as the editor, as in TodoPaper
  await page.evaluate(() => (window as any).cetli.runAction("console"));
  await expect(page.locator(".console-language option").first()).toHaveText(/^Python \d/);
  await page.locator(".console-input").fill("print(self.GetLineCount())");
  await page.locator(".console button").click();
  await expect(page.locator(".console-output")).toHaveText(/^\d+\nCommand completed successfully$/);
  await page.getByRole("button", { name: "Close" }).click();
});

test("spell checking uses the Windows spell checker: marks, suggestions", async () => {
  const lang = await page.evaluate(async () => {
    const langs: string[] = await (window as any).cetli.platform.spellLanguages();
    return langs.find((l) => l === "en-US") ?? langs.find((l) => l.startsWith("en")) ?? null;
  });
  test.skip(!lang, "no English spelling dictionary installed");
  await page.evaluate(async (lang) => {
    const app = (window as any).cetli;
    Object.assign(app.settings, { spellCheck: true, spellCheckLanguage: lang });
    app.view.dispatch({ changes: { from: 0, insert: "Thsi is a tset @mispeled:\n" } });
    app.applySettings();
    await app.runSpellCheck();
  }, lang);
  await expect(page.locator(".cm-tp-misspelled")).toHaveText(["Thsi", "tset"]);
  const suggestions = await page.evaluate((lang) => (window as any).cetli.platform.spellSuggest("Thsi", lang), lang);
  expect(suggestions).toContain("This");
  await page.evaluate(() => {
    const app = (window as any).cetli;
    app.settings.spellCheck = false;
    app.applySettings();
  });
});

test("tray icon can be shown and hidden", async () => {
  await page.evaluate(async () => {
    const inv = (window as any).__TAURI_INTERNALS__.invoke;
    await inv("set_tray_visible", { visible: true });
    await inv("set_tray_visible", { visible: false });
  });
});

test("New Window opens a second document; quick log can log into it", async () => {
  const other = join(dir, "work.txt");
  writeFileSync(other, "Clients:\r\n- ACME\r\n");
  await page.evaluate((p) => (window as any).cetli.newWindow(p), other);
  const second = await findPage((u) => u.includes("window=doc"));
  await expect.poll(() => second.evaluate(() => (window as any).cetli?.path ?? null), { timeout: 15000 }).toBe(other);
  await expect.poll(() => page.evaluate(() => (window as any).cetli.summaries.size)).toBe(1);
  await page.evaluate(() => (window as any).cetli.openQuickLog());
  const ql = await findPage((u) => u.includes("window=quicklog"));
  await expect(ql.locator(".quicklog-files")).toBeVisible();
  await ql.locator(".quicklog-files").selectOption({ label: "work.txt" });
  await ql.locator(".quicklog-project").selectOption("Clients");
  await ql.locator(".quicklog-text").focus();
  await ql.keyboard.type("call ACME");
  await ql.keyboard.press("Enter");
  await expect.poll(() => second.evaluate(() => (window as any).cetli.view.state.doc.toString())).toBe("Clients:\n- ACME\n- call ACME\n");
  expect(await docText()).not.toContain("call ACME");
});

test("closing the main window keeps the other window running and makes it primary", async () => {
  const second = await findPage((u) => u.includes("window=doc"));
  expect(await second.evaluate(() => (window as any).cetli.primary)).toBe(false);
  await page.evaluate(() => (window as any).cetli.quit(false)).catch(() => undefined);
  await expect.poll(() => second.evaluate(() => (window as any).cetli.primary), { timeout: 8000 }).toBe(true);
  expect(app.exitCode).toBeNull();
});
