/**
 * End-to-end tests of saving behaviour in the browser build: TodoPaper-style
 * backup autosave and crash recovery, the opt-in "save the file itself" mode,
 * and reloading files changed on disk (asking, or silently when enabled).
 */

import { Page, expect, test } from "@playwright/test";

const SAMPLE = "/demo/todo.taskpaper";
const BACKUP = "/demo/todo (autosave).taskpaper";

/** Current document text. */
async function doc(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).cetli.view.state.doc.toString());
}

/** Content of a file in the in-memory file system. */
async function file(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate((p) => (window as any).cetliWeb.files.get(p), path);
}

/** Change settings in the running app and apply them. */
async function setSettings(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((v) => {
    const app = (window as any).cetli;
    Object.assign(app.settings, v);
    app.applySettings();
  }, values);
}

/** Put the cursor at the end of the line containing `text`. */
async function cursorAfter(page: Page, text: string): Promise<void> {
  await page.evaluate((text) => {
    const view = (window as any).cetli.view;
    const line = view.state.doc.lineAt(view.state.doc.toString().indexOf(text));
    view.dispatch({ selection: { anchor: line.to } });
    view.focus();
  }, text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("Inbox:");
});

test("autosave writes a backup copy (TodoPaper); Ctrl+S saves the file and the backup stays until closing", async ({ page }) => {
  await setSettings(page, { autoSaveInterval: 1 });
  await cursorAfter(page, "- water the plants");
  await page.keyboard.type(" daily");
  await expect.poll(() => file(page, BACKUP), { timeout: 5000 }).toContain("- water the plants daily");
  expect(await file(page, SAMPLE)).not.toContain("daily");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => file(page, SAMPLE)).toContain("- water the plants daily");
  await expect(page.locator("#status-save")).toHaveText("Saved");
  expect(await file(page, BACKUP)).toBeDefined();
});

test("autosave can write the file itself instead", async ({ page }) => {
  await setSettings(page, { autoSaveMode: "file" });
  await cursorAfter(page, "- water the plants");
  await page.keyboard.type(" daily");
  await expect.poll(() => file(page, SAMPLE), { timeout: 5000 }).toContain("- water the plants daily");
});

test("a backup left by a crash is offered when the file is opened", async ({ page }) => {
  await page.evaluate(() => {
    const web = (window as any).cetliWeb;
    web.files.set("/demo/other.txt", "Other:\n- saved work\n");
    web.files.set("/demo/other (autosave).txt", "Recovered:\n- unsaved work\n");
    web.nextOpenPath = "/demo/other.txt";
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.locator(".modal-message")).toContainText("autosave (backup) file for this document exists");
  await page.locator(".modal-buttons button", { hasText: "Yes" }).click();
  await expect.poll(() => doc(page)).toBe("Recovered:\n- unsaved work\n");
  await expect(page.locator("#status-save")).toHaveText("Unsaved changes");
});

test("closing the file removes its backup copy", async ({ page }) => {
  await setSettings(page, { autoSaveInterval: 1 });
  await cursorAfter(page, "- water the plants");
  await page.keyboard.type("!");
  await expect.poll(() => file(page, BACKUP), { timeout: 5000 }).toBeDefined();
  await page.keyboard.press("ControlOrMeta+w");
  await page.locator(".modal-buttons button", { hasText: "Don't Save" }).click();
  await expect.poll(() => file(page, BACKUP)).toBeUndefined();
  expect(await file(page, SAMPLE)).not.toContain("plants!");
});

test("a file changed on disk asks before reloading (TodoPaper)", async ({ page }) => {
  await page.evaluate((p) => (window as any).cetliWeb.touch(p, "Changed:\n- elsewhere\n"), SAMPLE);
  await expect(page.locator(".modal-message")).toContainText("has changed on disk, would you like to reload the changes?", { timeout: 8000 });
  await page.locator(".modal-buttons button", { hasText: "Yes" }).click();
  await expect.poll(() => doc(page)).toBe("Changed:\n- elsewhere\n");
});

test("files changed on disk can reload silently", async ({ page }) => {
  await setSettings(page, { reloadSilently: true });
  await page.evaluate((p) => (window as any).cetliWeb.touch(p, "Changed:\n- elsewhere\n"), SAMPLE);
  await expect.poll(() => doc(page), { timeout: 8000 }).toBe("Changed:\n- elsewhere\n");
});
