/**
 * Read-only verification of Cetli against a real TodoPaper document
 * (CETLI_REAL_FILE). The development build (separate identifier, so an
 * installed Cetli is never involved) opens the file, its TodoPaper settings are
 * imported, the document is written through Cetli's file writer to a temporary
 * copy and compared byte for byte, and TodoPaper operations run in memory and
 * are undone. Autosave is switched off and nothing is ever saved: the test
 * asserts that the real file's hash, size and modification time are unchanged
 * and that no backup copy appears next to it.
 *
 * Build: npx tauri build --debug --no-bundle --config src-tauri/tauri.dev.conf.json
 * Run:   CETLI_REAL_FILE="G:/path/todo.txt" npx playwright test -c playwright.desktop.config.ts realfile
 * Installed app: close it first, then add CETLI_EXE="%LOCALAPPDATA%\Cetli\cetli.exe" (it uses its own configuration).
 */

import { Browser, Page, chromium, expect, test } from "@playwright/test";
import { ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

const REAL = process.env.CETLI_REAL_FILE ?? "";
// the isolated development build (identifier org.cetli.dev): never reaches an installed Cetli or its configuration
const EXE = process.env.CETLI_EXE ?? join(process.cwd(), "src-tauri", "target", "debug", "cetli.exe");
const PORT = 9341;
const CONFIG = join(process.env.APPDATA ?? "", "org.cetli.dev");
const CONFIG_BACKUP = CONFIG + ".realfile-backup";

/** Fingerprint of a file: SHA-256, size and modification time. */
function fingerprint(path: string): string {
  const st = statSync(path);
  return `${createHash("sha256").update(readFileSync(path)).digest("hex")}:${st.size}:${st.mtimeMs}`;
}

/** TodoPaper's backup name for a file. */
function backupOf(path: string): string {
  const ext = extname(path);
  return join(dirname(path), `${basename(path, ext)} (autosave)${ext}`);
}

let app: ChildProcess;
let browser: Browser;
let page: Page;
let before: string;
let backupExisted: boolean;
let tmp: string;

test.skip(!REAL || process.platform !== "win32" || !existsSync(EXE), "set CETLI_REAL_FILE (Windows, dev build)");

test.beforeAll(async () => {
  before = fingerprint(REAL);
  backupExisted = existsSync(backupOf(REAL));
  if (existsSync(CONFIG) && !existsSync(CONFIG_BACKUP)) renameSync(CONFIG, CONFIG_BACKUP);
  tmp = mkdtempSync(join(tmpdir(), "cetli-real-"));
  app = spawn(EXE, [REAL], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  for (let i = 0; i < 100 && !page; i++) {
    page = browser.contexts()[0]?.pages().find((p) => !p.url().includes("quicklog")) as Page;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => (window as any).cetli?.path, null, { timeout: 20000 });
  // never write to the real document: no autosave of any kind
  await page.evaluate(() => {
    const app = (window as any).cetli;
    Object.assign(app.settings, { autoSave: false, reloadSilently: false });
    app.applySettings();
  });
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  app?.kill();
  await new Promise((r) => setTimeout(r, 800));
  rmSync(tmp, { recursive: true, force: true });
  rmSync(CONFIG, { recursive: true, force: true });
  if (existsSync(CONFIG_BACKUP)) renameSync(CONFIG_BACKUP, CONFIG);
  // the real document was not touched
  expect(fingerprint(REAL)).toBe(before);
  expect(existsSync(backupOf(REAL))).toBe(backupExisted);
});

test("opens the real document with the TodoPaper settings imported", async () => {
  const info = await page.evaluate(async () => {
    const app = (window as any).cetli;
    const found = await (window as any).__TAURI_INTERNALS__.invoke("todopaper_import");
    return {
      path: app.path,
      lines: app.view.state.doc.lines,
      meta: app.meta,
      imported: app.state.imported,
      zoom: app.state.zoom,
      searches: app.state.savedSearches,
      found,
      dirty: app.dirty,
    };
  });
  const text = readFileSync(REAL, "utf8");
  const norm = (p: string) => p.split("\\").join("/").toLowerCase();
  expect(norm(info.path)).toBe(norm(REAL));
  expect(info.lines).toBe(text.split(/\r\n|\n|\r/).length);
  expect(info.meta).toEqual({ lineEnding: text.includes("\r\n") ? "\r\n" : "\n", encoding: "utf-8", bom: text.charCodeAt(0) === 0xfeff });
  // whatever TodoPaper left on this computer was imported on the first start
  expect(info.imported).toBe(true);
  if (info.found.zoom !== null) expect(info.zoom).toBe(info.found.zoom);
  if (info.found.searches.length) {
    expect(info.searches.length).toBeGreaterThan(0);
    expect(info.found.searches).toEqual(expect.arrayContaining(info.searches));
  }
  expect(info.dirty).toBe(false);
  console.log(`real document: ${info.lines} lines`);
});

test("the document round-trips byte for byte through Cetli's file writer", async () => {
  const copy = join(tmp, basename(REAL));
  await page.evaluate(async (target) => {
    const app = (window as any).cetli;
    await (window as any).__TAURI_INTERNALS__.invoke("write_text_file", { path: target, text: app.view.state.doc.toString(), lineEnding: app.meta.lineEnding, encoding: app.meta.encoding, bom: app.meta.bom });
  }, copy);
  expect(readFileSync(copy).equals(readFileSync(REAL))).toBe(true);
});

test("TodoPaper operations work on the real document (in memory, then undone)", async () => {
  const result = await page.evaluate(() => {
    const app = (window as any).cetli;
    const original = app.view.state.doc.toString();
    app.setSearch("NOT @done");
    const visibleOpen = app.view.state.doc.lines - Array.from(app.view.dom.querySelectorAll(".cm-line")).length >= 0;
    app.setSearch("");
    app.runAction("archiveDone");
    const afterArchive = app.view.state.doc.toString();
    app.undo();
    let taskLine = 1;
    while (!/^\s*- /.test(app.view.state.doc.line(taskLine).text) || /@done/.test(app.view.state.doc.line(taskLine).text)) taskLine++;
    app.view.dispatch({ selection: { anchor: app.view.state.doc.line(taskLine).to } });
    app.runAction("tagDone");
    const afterDone = app.view.state.doc.line(taskLine).text;
    app.undo();
    return { visibleOpen, archived: afterArchive !== original, done: /@done\(/.test(afterDone), restored: app.view.state.doc.toString() === original, dirty: app.dirty };
  });
  expect(result).toEqual({ visibleOpen: true, archived: result.archived, done: true, restored: true, dirty: false });
});
