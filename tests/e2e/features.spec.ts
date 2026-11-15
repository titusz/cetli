/**
 * End-to-end tests (browser build) for TodoPaper features beyond editing:
 * window transparency, dropping files as links, plugins and the console,
 * new windows, and the quick log file choice with several documents.
 */

import { Page, expect, test } from "@playwright/test";

/** Current document text. */
async function doc(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).cetli.view.state.doc.toString());
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

/** Install plugin sources and (re)load plugins. */
async function installPlugins(page: Page, plugins: Record<string, string>): Promise<void> {
  await page.evaluate(async (plugins) => {
    const web = (window as any).cetliWeb;
    for (const [path, code] of Object.entries(plugins)) web.plugins.set(path, code);
    await (window as any).cetli.loadPlugins();
  }, plugins);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("Inbox:");
});

test("window transparency in steps of 15 (Ctrl+Shift+9 / 0 / 8)", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+Digit9");
  await page.keyboard.press("Control+Shift+Digit9");
  await expect.poll(() => page.evaluate(() => (window as any).cetli.state.opacity)).toBe(225);
  expect(Number(await page.evaluate(() => document.documentElement.style.opacity))).toBeCloseTo(225 / 255, 4);
  await page.keyboard.press("Control+Shift+Digit0");
  await expect.poll(() => page.evaluate(() => (window as any).cetli.state.opacity)).toBe(240);
  await page.keyboard.press("Control+Shift+Digit8");
  await expect.poll(() => page.evaluate(() => (window as any).cetli.state.opacity)).toBe(255);
  expect(await page.evaluate(() => document.documentElement.style.opacity)).toBe("");
});

test("dropping files inserts file:/// links", async ({ page }) => {
  await cursorAfter(page, "- water the plants");
  const box = await page.locator(".cm-line", { hasText: "water the plants" }).boundingBox();
  const dt = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["a"], "my notes.txt"));
    dt.items.add(new File(["b"], "plan.pdf"));
    return dt;
  });
  await page.dispatchEvent(".cm-content", "drop", { dataTransfer: dt, clientX: box!.x + box!.width - 2, clientY: box!.y + box!.height / 2 });
  await expect.poll(() => doc(page)).toContain("file:///dropped/my%20notes.txt file:///dropped/plan.pdf");
});

test("plugins add menu items with shortcuts, run on start and react to tags", async ({ page }) => {
  await installPlugins(page, {
    "/plugins/stamp.js": `
      export const name = "Stamper";
      export default function (cetli) {
        cetli.addMenuItem("Insert Stamp", () => cetli.insertText("[stamp]"), "Mod-Alt-j");
        cetli.onTagChange("today", (e) => cetli.app.view.dom.setAttribute("data-tag-event", e.tag + ":" + e.added + ":" + e.line));
        cetli.onStart(() => {});
      }`,
    "/plugins/broken.js": "export default 42;",
  });
  await page.locator(".menubar-item", { hasText: "Tools" }).click();
  await page.locator(".menu-item", { hasText: "Plugins" }).hover();
  await expect(page.locator(".menu-item", { hasText: "broken (failed to load)" })).toBeVisible();
  await page.keyboard.press("Escape");
  await cursorAfter(page, "- water the plants");
  await page.locator(".menubar-item", { hasText: "Tools" }).click();
  await page.locator(".menu-item", { hasText: "Plugins" }).hover();
  await page.locator(".menu-item", { hasText: "Stamper" }).hover();
  await page.locator(".menu-item", { hasText: "Insert Stamp" }).click();
  await expect.poll(() => doc(page)).toContain("- water the plants[stamp]");
  await page.keyboard.press("Control+Alt+j");
  await expect.poll(() => doc(page)).toContain("- water the plants[stamp][stamp]");
  await page.keyboard.press("Control+y");
  await expect(page.locator(".cm-editor")).toHaveAttribute("data-tag-event", "@today:true:13");
});

test("the console runs JavaScript against the document", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+`");
  await page.locator(".console-input").fill('cetli.addToProject("- from the console", "Home"); return cetli.lineCount();');
  await page.locator(".console button").click();
  await expect(page.locator(".console-output")).toHaveText(/^\d+$/);
  expect(await doc(page)).toContain("- pay rent @done(2026-11-01)\n- from the console");
  await page.locator(".console-input").fill("throw new Error('boom')");
  await page.locator(".console button").click();
  await expect(page.locator(".console-output")).toContainText("boom");
});

test("New Window (Ctrl+Alt+N) opens another document window", async ({ page, context }) => {
  await page.locator(".cm-content").click();
  const popup = context.waitForEvent("page");
  await page.keyboard.press("Control+Alt+n");
  const win = await popup;
  await win.waitForLoadState();
  expect(win.url()).toContain("window=doc");
  await expect(win.locator(".cm-editor")).toBeVisible();
  expect(await win.evaluate(() => (window as any).cetli.view.state.doc.toString())).toBe("");
});

test("quick log offers a file choice when several documents are open", async ({ page }) => {
  const target = await page.evaluate(async () => {
    const modulePath = "/src/app/quicklog.ts";
    const { openQuickLogOverlay } = await import(/* @vite-ignore */ modulePath);
    return new Promise<string>((resolve) => {
      openQuickLogOverlay(
        {
          defaultProject: "Inbox",
          files: [
            { label: "main", title: "todo.taskpaper", projects: [{ name: "Inbox", depth: 0 }] },
            { label: "doc-2", title: "work.taskpaper", projects: [{ name: "Clients", depth: 0 }] },
          ],
        },
        (p: { target: string; project: string; text: string }) => resolve(`${p.target}|${p.project}|${p.text}`),
      );
      const files = document.querySelector<HTMLSelectElement>(".quicklog-files")!;
      files.value = "1";
      files.dispatchEvent(new Event("change"));
      const project = document.querySelector<HTMLSelectElement>(".quicklog-project")!;
      project.value = "Clients";
      const text = document.querySelector<HTMLTextAreaElement>(".quicklog-text")!;
      text.value = "- call ACME";
      text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  });
  expect(target).toBe("doc-2|Clients|- call ACME");
});

test("spell checking marks misspellings; the context menu offers suggestions and Add Word", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).cetliWeb.dictionary = { thsi: ["this", "thus"], plnts: ["plants"] };
    const app = (window as any).cetli;
    app.settings.spellCheck = true;
    app.view.dispatch({ changes: { from: 0, insert: "Thsi plnts here:\n" } });
    app.applySettings();
  });
  await expect(page.locator(".cm-tp-misspelled")).toHaveCount(2);
  await page.locator(".cm-tp-misspelled", { hasText: "Thsi" }).click({ button: "right" });
  await page.locator(".menu-item", { hasText: "Spelling" }).first().hover();
  await page.locator(".menu-item", { hasText: /^\s*this\s*$/ }).click();
  await expect.poll(() => doc(page)).toContain("this plnts here:");
  await page.locator(".cm-tp-misspelled", { hasText: "plnts" }).click({ button: "right" });
  await page.locator(".menu-item", { hasText: "Spelling" }).first().hover();
  await page.locator(".menu-item", { hasText: "Add Word to Dictionary" }).click();
  await expect(page.locator(".cm-tp-misspelled")).toHaveCount(0);
});

test("Page Setup is used when printing", async ({ page }) => {
  await page.evaluate(() => (window.print = () => {}));
  await page.locator(".menubar-item", { hasText: "File" }).click();
  await page.locator(".menu-item", { hasText: "Page Setup" }).click();
  await page.locator(".page-setup select[name=orientation]").selectOption("landscape");
  await page.locator(".page-setup input[name=margin]").fill("25");
  await page.locator(".modal-buttons button", { hasText: "OK" }).click();
  await page.locator(".menubar-item", { hasText: "File" }).click();
  await page.locator(".menu-item", { hasText: "Print" }).click();
  await expect.poll(() => page.locator("#page-setup").evaluate((e) => e.textContent)).toMatch(/size: landscape; margin: 25mm;/);
});

test("Help offers documentation and debug information with the error log", async ({ page }) => {
  await page.evaluate(() => console.error("something went wrong in a test"));
  await page.locator(".menubar-item", { hasText: "Help" }).click();
  await page.locator(".menu-item", { hasText: "Documentation" }).click();
  await expect(page.locator(".modal h2")).toHaveText("Cetli Documentation");
  await page.locator(".modal-buttons button", { hasText: "Close" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+F10");
  await expect(page.locator(".modal h2")).toHaveText("Debug Information");
  await expect(page.locator(".debug-log")).toContainText("something went wrong in a test");
});
