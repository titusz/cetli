/**
 * End-to-end tests of the Cetli UI in a real browser (web platform build):
 * typing behaviour, shortcuts, search, folding, views, outline, archive,
 * quick log, saving and external change detection.
 */

import { Page, expect, test } from "@playwright/test";


/** Current document text. */
async function doc(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).cetli.view.state.doc.toString());
}

/** Text of a 1-based document line. */
async function line(page: Page, n: number): Promise<string> {
  return page.evaluate((n) => (window as any).cetli.view.state.doc.line(n).text, n);
}

/** Put the cursor at the end of the first line containing `text` and focus the editor. */
async function cursorAfter(page: Page, text: string): Promise<void> {
  await page.evaluate((text) => {
    const view = (window as any).cetli.view;
    const d = view.state.doc.toString();
    const at = d.indexOf(text);
    if (at < 0) throw new Error("not found: " + text);
    const ln = view.state.doc.lineAt(at);
    view.dispatch({ selection: { anchor: ln.to } });
    view.focus();
  }, text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("Inbox:");
});

test("Enter after a task starts a new task; empty task Enter clears it", async ({ page }) => {
  await cursorAfter(page, "- try Cetli @today");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second task");
  expect(await line(page, 3)).toBe("- second task");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(await line(page, 4)).toBe("");
});

test("Enter at the end of a project line starts its first task", async ({ page }) => {
  await cursorAfter(page, "Home:");
  await page.keyboard.press("Enter");
  await page.keyboard.type("new chore");
  expect(await doc(page)).toContain("Home:\n- new chore\n- buy milk");
});

test("Tab and Shift+Tab indent and outdent", async ({ page }) => {
  await cursorAfter(page, "- water the plants");
  await page.keyboard.press("Tab");
  expect(await doc(page)).toContain("\n\t- water the plants");
  await page.keyboard.press("Shift+Tab");
  expect(await doc(page)).toContain("\n- water the plants");
});

test("Ctrl+D toggles @done with today's date", async ({ page }) => {
  await cursorAfter(page, "- buy milk @errand");
  await page.keyboard.press("Control+d");
  expect(await doc(page)).toMatch(/- buy milk @errand @done\(\d{4}-\d{2}-\d{2}\)/);
  await page.keyboard.press("Control+d");
  expect(await doc(page)).toContain("- buy milk @errand\n");
});

test("tag shortcuts: today, priority, date", async ({ page }) => {
  await cursorAfter(page, "- water the plants");
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+3");
  await page.keyboard.press("Control+u");
  expect(await doc(page)).toMatch(/- water the plants @today @priority\(3\) @date\(\d{4}-\d{2}-\d{2}\)/);
});

test("Ctrl+T, Ctrl+P and Ctrl+G create task, project and tag", async ({ page }) => {
  await cursorAfter(page, "- buy milk @errand");
  await page.keyboard.press("Control+t");
  await page.keyboard.type("eggs");
  expect(await doc(page)).toContain("- buy milk @errand\n- eggs");
  await page.keyboard.press("Control+p");
  await page.keyboard.type("Groceries");
  expect(await doc(page)).toContain("Groceries:\n- eggs");
  await cursorAfter(page, "- eggs");
  await page.keyboard.press("Control+g");
  await page.keyboard.type("shop");
  await page.keyboard.press("Escape");
  expect(await doc(page)).toContain("- eggs @shop");
});

test("clicking a gutter checkbox marks the task done", async ({ page }) => {
  await page.locator(".cm-tp-gutter-open").filter({ visible: true }).first().click();
  expect(await line(page, 2)).toMatch(/- try Cetli @today @done\(/);
  await expect(page.locator(".cm-tp-gutter-done")).toHaveCount(4);
});

test("the margin looks like TodoPaper's: a grey strip, square boxes, a green tick, yellow while searching", async ({ page }) => {
  const margin = page.locator(".cm-gutters");
  await expect(margin).toHaveCSS("background-color", "rgb(224, 224, 224)");
  await expect(margin).toHaveCSS("width", "32px");
  const box = page.locator(".cm-tp-gutter-open").filter({ visible: true }).first();
  await expect(box).toHaveCSS("width", "12px");
  await expect(box).toHaveCSS("border-radius", "1px");
  await expect(box).toHaveCSS("border-top-color", "rgb(131, 131, 131)");
  const tick = await page.locator(".cm-tp-gutter-done").first().evaluate((el) => getComputedStyle(el, "::after").backgroundImage);
  expect(decodeURIComponent(tick)).toContain("stroke='#8bd17f'");
  // the strip fills the editor's height and the text starts right of it
  const [strip, scroller, text] = await Promise.all([".cm-gutters", ".cm-scroller", ".cm-line"].map((s) => page.locator(s).first().boundingBox()));
  expect(strip!.y + strip!.height).toBeGreaterThanOrEqual(scroller!.y + scroller!.height);
  expect(text!.x).toBe(32);
  // a search colours it, in every theme
  await page.locator("#search").fill("@errand");
  await expect(margin).toHaveCSS("background-color", "rgb(254, 244, 190)");
  await page.locator("#search").fill("");
  await expect(margin).toHaveCSS("background-color", "rgb(224, 224, 224)");
  await page.evaluate(() => {
    const app = (window as any).cetli;
    app.settings.theme = { ...app.settings.theme, background: "#4B4B4B" };
    app.applySettings();
  });
  await expect(page.locator(".cm-editor")).toHaveCSS("background-color", "rgb(75, 75, 75)");
  await expect(margin).toHaveCSS("background-color", "rgb(224, 224, 224)");
});

test("search filters lines with their projects; Escape resets", async ({ page }) => {
  await page.locator("#search").fill("@today");
  await expect(page.locator(".cm-line")).toHaveText(["Inbox:", "- try Cetli @today", "Work:", "- call Bob about the launch @today"]);
  await page.locator("#search").press("Escape");
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator(".cm-content")).toContainText("buy milk");
});

test("project search and NOT", async ({ page }) => {
  await page.locator("#search").fill("<Work> NOT @done");
  await expect(page.locator(".cm-line")).toHaveText(["Work:", "- write the quarterly report @priority(1)", "	Include numbers from https://example.com/stats", "- call Bob about the launch @today", ""]);
});

test("Ctrl+click on a tag toggles it in the search", async ({ page }) => {
  await page.keyboard.down("Control");
  await page.locator(".cm-tp-tag", { hasText: "@errand" }).click();
  await page.keyboard.up("Control");
  await expect(page.locator("#search")).toHaveValue("@errand");
  await expect(page.locator(".cm-line")).toHaveText(["Home:", "- buy milk @errand"]);
});

test("Ctrl+H hides done tasks", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+h");
  await expect(page.locator("#search")).toHaveValue("NOT @done");
  await expect(page.locator(".cm-content")).not.toContainText("fix printer");
});

test("editing in a filtered view keeps lines visible and offers refresh", async ({ page }) => {
  await page.locator("#search").fill("@today");
  await cursorAfter(page, "- try Cetli @today");
  await page.keyboard.press("Enter");
  await page.keyboard.type("not tagged");
  await expect(page.locator(".cm-content")).toContainText("not tagged");
  await expect(page.locator("#search-refresh")).toBeVisible();
  await page.locator("#search-refresh").click();
  await expect(page.locator(".cm-content")).not.toContainText("not tagged");
});

test("folding a project hides its tasks; placeholder unfolds", async ({ page }) => {
  const arrows = page.locator(".cm-tp-gutter .cm-gutterElement").filter({ has: page.locator(".cm-tp-gutter-expanded") });
  await arrows.nth(1).click(); // Work:
  await expect(page.locator(".cm-content")).not.toContainText("quarterly report");
  await expect(page.locator(".cm-tp-fold-placeholder")).toHaveCount(1);
  await page.locator(".cm-tp-fold-placeholder").click();
  await expect(page.locator(".cm-content")).toContainText("quarterly report");
});

test("collapse all and expand all", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+.");
  await expect(page.locator(".cm-tp-fold-placeholder")).toHaveCount(4);
  await page.keyboard.press("Control+,");
  await expect(page.locator(".cm-tp-fold-placeholder")).toHaveCount(0);
});

test("tag autocompletion after @", async ({ page }) => {
  await cursorAfter(page, "- water the plants");
  await page.keyboard.type(" @er");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await expect(page.locator(".cm-tooltip-autocomplete li").first()).toHaveText("@errand");
  await page.waitForTimeout(120);
  await page.keyboard.press("Tab");
  expect(await doc(page)).toContain("- water the plants @errand");
});

test("move lines with Ctrl+Up / Ctrl+Down", async ({ page }) => {
  await cursorAfter(page, "- water the plants");
  await page.keyboard.press("Control+ArrowUp");
  expect(await doc(page)).toContain("Home:\n- water the plants\n- buy milk @errand");
  await page.keyboard.press("Control+ArrowDown");
  expect(await doc(page)).toContain("Home:\n- buy milk @errand\n- water the plants");
});

test("archive done tasks", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+D");
  const text = await doc(page);
  expect(text).not.toContain("- fix printer @done(2026-11-10)\n- \n");
  expect(text).toContain("Archive:\n- fix printer @done(2026-11-10) @archive(Work)\n- pay rent @done(2026-11-01) @archive(Home)\n- old task");
});

test("views keep their own search", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Alt+t");
  await expect(page.locator("#tabs")).toBeVisible();
  await page.locator("#search").fill("@today");
  await page.locator("#search").press("Tab");
  await expect(page.locator(".tab.active span").first()).toHaveText("@today");
  await page.keyboard.press("Control+Tab");
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator(".cm-content")).toContainText("buy milk");
  await page.keyboard.press("Control+Tab");
  await expect(page.locator("#search")).toHaveValue("@today");
  await page.keyboard.press("Control+w");
  await expect(page.locator("#tabs")).toBeHidden();
});

test("outline sidebar lists projects and jumps to them", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Alt+o");
  await expect(page.locator("#outline-list li")).toHaveText(["Inbox", "Work", "Home", "Archive"]);
  await page.locator("#outline-list li", { hasText: "Home" }).dblclick();
  await expect(page.locator("#search")).toHaveValue("<Home>");
  await page.locator("#outline-mode").selectOption("tags");
  await expect(page.locator("#outline-list li", { hasText: "@errand" })).toBeVisible();
});

test("menu bar runs actions", async ({ page }) => {
  await cursorAfter(page, "- water the plants");
  await page.locator(".menubar-item", { hasText: "Tools" }).click();
  await page.locator(".menu-item", { hasText: "Tag Today" }).click();
  expect(await doc(page)).toContain("- water the plants @today");
});

test("context menu moves a line to another project", async ({ page }) => {
  await page.locator(".cm-line", { hasText: "water the plants" }).click({ button: "right" });
  await page.locator(".menu-item", { hasText: "Move Line To" }).hover();
  await page.locator(".menu-item", { hasText: /^\s*Inbox/ }).last().click();
  expect(await doc(page)).toContain("Inbox:\n- water the plants\n- try Cetli");
});

test("quick log adds an item to the inbox", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+l");
  await expect(page.locator(".quicklog-text")).toBeFocused();
  await page.keyboard.type("call the dentist");
  await page.keyboard.press("Enter");
  expect(await doc(page)).toContain("- read the shortcuts list in Help @cetli\n- call the dentist\n");
});

test("preferences: switching theme applies live and cancel reverts", async ({ page }) => {
  await page.locator(".menubar-item", { hasText: "Edit" }).click();
  await page.locator(".menu-item", { hasText: "Preferences" }).click();
  await page.locator(".pref-tab", { hasText: "Appearance" }).click();
  await page.locator(".pref-panel select").first().selectOption("TodoPaper Dark");
  await expect(page.locator("body")).toHaveClass(/dark/);
  await page.locator(".modal-buttons button", { hasText: "Cancel" }).click();
  await expect(page.locator("body")).not.toHaveClass(/dark/);
});

test("F1 shows the shortcut reference", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("F1");
  await expect(page.locator(".modal h2")).toHaveText("Keyboard Shortcuts");
  await expect(page.locator(".help-table").first()).toContainText("Tag Done");
});

test("select hierarchy and move with children", async ({ page }) => {
  await cursorAfter(page, "Home:");
  await page.keyboard.press("Control+Alt+ArrowUp");
  const text = await doc(page);
  expect(text.indexOf("Home:")).toBeLessThan(text.indexOf("Work:"));
  expect(text).toContain("Home:\n- buy milk @errand\n- water the plants\n- pay rent @done(2026-11-01)\n\nWork:");
});

test("a search hiding the top lines keeps the first visible line styled with the right gutter icon", async ({ page }) => {
  await page.locator("#search").fill("@errand");
  const first = page.locator(".cm-line").first();
  await expect(first).toHaveText("Home:");
  await expect(first).toHaveClass(/cm-tp-project/);
  await expect(page.locator(".cm-tp-gutter-expanded").filter({ visible: true })).toHaveCount(1);
  await expect(page.locator(".cm-tp-gutter-open").filter({ visible: true })).toHaveCount(1);
});

test("Ctrl+F opens find and replace", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+f");
  await expect(page.locator(".cm-search input[name=search]")).toBeFocused();
  await page.keyboard.type("milk");
  await page.keyboard.press("Enter");
  const sel = await page.evaluate(() => {
    const st = (window as any).cetli.view.state;
    return st.sliceDoc(st.selection.main.from, st.selection.main.to);
  });
  expect(sel).toBe("milk");
});

test("Ctrl+mouse wheel changes the font size", async ({ page }) => {
  const before = await page.evaluate(() => (window as any).cetli.state.zoom);
  await page.locator(".cm-content").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() => (window as any).cetli.state.zoom)).toBe(before + 1);
});

test("print renders the visible lines into the print area", async ({ page }) => {
  await page.evaluate(() => (window.print = () => {}));
  await page.locator("#search").fill("@today");
  await page.locator(".menubar-item", { hasText: "File" }).click();
  await page.locator(".menu-item", { hasText: "Print" }).click();
  await expect(page.locator("#print-area .cm-line")).toHaveText(["Inbox:", "- try Cetli @today", "Work:", "- call Bob about the launch @today"]);
  await expect(page.locator("#print-area .cm-tp-project-top")).toHaveCount(2);
});

test("new document asks to save unsaved untitled changes", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+n");
  await expect.poll(() => doc(page)).toBe("");
  await page.keyboard.type("Draft:");
  await page.keyboard.press("Control+n");
  await expect(page.locator(".modal-message")).toHaveText("Save changes to Untitled?");
  await page.locator(".modal-buttons button", { hasText: "Cancel" }).click();
  expect(await doc(page)).toBe("Draft:");
  await page.keyboard.press("Control+n");
  await page.locator(".modal-buttons button", { hasText: "Don't Save" }).click();
  await expect.poll(() => doc(page)).toBe("");
});

test("a lone Alt press opens the menu bar; arrows navigate", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Alt");
  await expect(page.locator(".menu")).toBeVisible();
  await expect(page.locator(".menubar-item.open")).toHaveText("File");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".menubar-item.open")).toHaveText("Edit");
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu")).toHaveCount(0);
  await page.keyboard.press("Alt+s");
  await expect(page.locator(".menu")).toHaveCount(0);
});
