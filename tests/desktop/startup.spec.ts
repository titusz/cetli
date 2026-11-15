/**
 * Start-up check of a built Cetli on Linux, macOS and Windows: the app is
 * started with a document and has to record it as its last file. It does that
 * only after its webview has loaded the UI and read the file through the Rust
 * shell. A screenshot is kept where the system has a command for one.
 *
 * Default: the isolated development build (identifier org.cetli.dev).
 * Another build: CETLI_EXE=path/to/cetli CETLI_IDENTIFIER=org.cetli.app, on a
 * computer where that app has no configuration yet (the build servers).
 */

import { expect, test } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const DEV_IDENTIFIER = "org.cetli.dev";
const IDENTIFIER = process.env.CETLI_IDENTIFIER ?? DEV_IDENTIFIER;
const EXE = resolve(process.env.CETLI_EXE ?? join("src-tauri", "target", "debug", process.platform === "win32" ? "cetli.exe" : "cetli"));
const CONFIG = configDir(IDENTIFIER);
const CONFIG_BACKUP = CONFIG + ".startup-backup";

/** Commands that save a screenshot of the screen to the path appended to them. */
const SCREENSHOT: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ["import", "-window", "root"],
  darwin: ["screencapture", "-x"],
};

/** Cetli's configuration folder for an app identifier. */
function configDir(identifier: string): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? "", identifier);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", identifier);
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), identifier);
}

/** Name of the file Cetli recorded as its last one ("" until it has). */
function lastFileName(): string {
  try {
    return basename(JSON.parse(readFileSync(join(CONFIG, "state.json"), "utf8")).lastFile ?? "");
  } catch {
    return "";
  }
}

test.skip(!existsSync(EXE), `no build at ${EXE}`);
// only the development build's configuration is moved aside; any other app's is left alone
test.skip(IDENTIFIER !== DEV_IDENTIFIER && existsSync(CONFIG), `${CONFIG} belongs to an installed Cetli`);

test("the built app starts and opens the document it was started with", async ({}, testInfo) => {
  if (existsSync(CONFIG) && !existsSync(CONFIG_BACKUP)) renameSync(CONFIG, CONFIG_BACKUP);
  const dir = mkdtempSync(join(tmpdir(), "cetli-startup-"));
  const file = join(dir, "startup.taskpaper");
  writeFileSync(file, "Inbox:\n- Cetli starts on this system @today\n- an earlier task @done(2026-11-15)\n");
  const app = spawn(EXE, [file], { stdio: ["ignore", "pipe", "pipe"] });
  let exit: string | null = null;
  app.on("exit", (code, signal) => (exit = `exited with ${code ?? signal}`));
  app.on("error", (e) => (exit = String(e)));
  app.stdout.on("data", (d) => process.stdout.write(d));
  app.stderr.on("data", (d) => process.stderr.write(d));
  try {
    await expect.poll(() => exit ?? lastFileName(), { timeout: 45_000 }).toBe(basename(file));
    // it keeps running, with its window painted
    await new Promise((r) => setTimeout(r, 3000));
    const shot = SCREENSHOT[process.platform];
    if (shot) spawnSync(shot[0], [...shot.slice(1), testInfo.outputPath(`cetli-${process.platform}.png`)]);
    expect(exit).toBeNull();
  } finally {
    app.kill();
    await new Promise((r) => setTimeout(r, 800));
    rmSync(dir, { recursive: true, force: true });
    rmSync(CONFIG, { recursive: true, force: true });
    if (existsSync(CONFIG_BACKUP)) renameSync(CONFIG_BACKUP, CONFIG);
  }
});
