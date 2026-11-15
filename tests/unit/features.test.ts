/** Tests for backup names, file links, app state merging, autosave import and plugin tag hooks. */

import { describe, expect, test } from "vitest";
import { backupPath, fileUrl, todoPaperFormat } from "../../src/core/paths";
import { buildOutline } from "../../src/core/outline";
import { parseQuery, visibleLines } from "../../src/core/search";
import { archiveDone } from "../../src/editor/commands";
import { DEFAULT_APP_STATE, DEFAULT_SETTINGS, importTodoPaperSettings, mergeAppState } from "../../src/app/settings";
import { PluginHooks, detectTagChanges } from "../../src/app/plugins";
import { apply, mk } from "./helpers";

describe("paths", () => {
  test("backup copies use TodoPaper's naming", () => {
    expect(backupPath("C:\\Notes\\todo.txt")).toBe("C:\\Notes\\todo (autosave).txt");
    expect(backupPath("/home/me/todo.taskpaper")).toBe("/home/me/todo (autosave).taskpaper");
    expect(backupPath("/home/me/todo")).toBe("/home/me/todo (autosave)");
    expect(backupPath("/home/.config/todo")).toBe("/home/.config/todo (autosave)");
  });

  test("file links like TodoPaper's dropped files", () => {
    expect(fileUrl("C:\\My Docs\\plan.pdf")).toBe("file:///C:/My%20Docs/plan.pdf");
    expect(fileUrl("/home/me/a b.txt")).toBe("file:///home/me/a%20b.txt");
  });
});

describe("app state merge across windows", () => {
  const stored = { ...DEFAULT_APP_STATE, recentFiles: ["/a", "/b"], views: { "/a": { queries: ["x"], active: 0, folded: [] } } };
  const mine = { ...DEFAULT_APP_STATE, recentFiles: ["/c", "/a"], zoom: 3, views: { "/c": { queries: [""], active: 0, folded: [] } } };

  test("recent files and views are combined, other fields come from this window", () => {
    const merged = mergeAppState(stored, mine);
    expect(merged.recentFiles).toEqual(["/c", "/a", "/b"]);
    expect(Object.keys(merged.views).sort()).toEqual(["/a", "/c"]);
    expect(merged.zoom).toBe(3);
  });

  test("clearing recent files replaces them", () => {
    expect(mergeAppState(stored, { ...mine, recentFiles: [] }, true).recentFiles).toEqual([]);
  });
});

describe("autosave settings import", () => {
  test("TodoPaper autosave becomes the backup mode with its interval", () => {
    const s = importTodoPaperSettings(`settings = "{'autosave': True, 'autosave_interval': 120000}"`);
    expect(s.autoSave).toBe(true);
    expect(s.autoSaveMode).toBe("backup");
    expect(s.autoSaveInterval).toBe(120);
  });

  test("defaults follow TodoPaper", () => {
    expect(DEFAULT_SETTINGS.autoSaveMode).toBe("backup");
    expect(DEFAULT_SETTINGS.reloadSilently).toBe(false);
  });
});

describe("plugin tag hooks", () => {
  const hooks = (): PluginHooks => ({ start: [], tags: new Map([["@today", [() => {}]]]) });

  test("adding and removing a watched tag is reported with its line", () => {
    const s = mk("P:\n- a\n- b");
    const added = s.update({ changes: { from: s.doc.line(3).to, insert: " @today" } });
    expect(detectTagChanges(added, hooks())).toEqual([{ tag: "@today", line: 3, text: "- b @today", added: true }]);
    const removed = added.state.update({ changes: { from: added.state.doc.line(3).to - 7, to: added.state.doc.line(3).to } });
    expect(detectTagChanges(removed, hooks())).toEqual([{ tag: "@today", line: 3, text: "- b", added: false }]);
  });

  test("other tags and unchanged documents report nothing", () => {
    const s = mk("- a");
    expect(detectTagChanges(s.update({ changes: { from: 3, insert: " @work" } }), hooks())).toEqual([]);
    expect(detectTagChanges(s.update({ selection: { anchor: 1 } }), hooks())).toEqual([]);
  });
});

describe("TodoPaper fidelity", () => {
  test("files are written like TodoPaper did on Windows: UTF-8, CRLF, LF for .taskpaper", () => {
    const lf = { lineEnding: "\n" as const, encoding: "utf-8", bom: false };
    expect(todoPaperFormat("C:/Notes/todo.txt", lf, true)).toEqual({ lineEnding: "\r\n", encoding: "utf-8", bom: false });
    expect(todoPaperFormat("C:/Notes/todo.taskpaper", { ...lf, lineEnding: "\r\n" }, true).lineEnding).toBe("\n");
    expect(todoPaperFormat("x.todopaper", { lineEnding: "\r\n", encoding: "utf-16le", bom: true }, true)).toEqual({ lineEnding: "\r\n", encoding: "utf-8", bom: false });
    expect(todoPaperFormat("x.txt", { lineEnding: "\r\n", encoding: "utf-8", bom: true }, true).bom).toBe(true);
    expect(todoPaperFormat("x.txt", lf, false).lineEnding).toBe("\n");
  });

  test("<Project> search matches 'name:' anywhere, as TodoPaper did", () => {
    const doc = ["Work:", "- report", "Homework:", "- math", "Home:", "- see Work: agenda", "- other"];
    const flags = visibleLines(buildOutline(doc), doc, parseQuery("<Work>"));
    expect(Array.from(flags)).toEqual([1, 1, 1, 1, 1, 1, 0]);
  });

  test("Archive Done also takes @DONE (TodoPaper matched case-insensitively)", () => {
    let s = mk("P:\n- a @DONE\n- b");
    s = apply(s, archiveDone(s));
    expect(s.doc.toString()).toBe("P:\n- b\n\nArchive:\n- a @DONE @archive(P)");
  });
});

describe("spelling and page setup", () => {
  test("misspellings inside tags and links are ignored", async () => {
    const { keepSpellingRanges, languageTag } = await import("../../src/core/spelling");
    const text = "- Thsi @tset www.exmaple.com tset";
    expect(keepSpellingRanges(text, [[2, 4], [8, 4], [17, 7], [29, 4]])).toEqual([[2, 4], [29, 4]]);
    expect(languageTag("en_US")).toBe("en-US");
  });

  test("page setup becomes an @page rule; TodoPaper spelling language is imported", async () => {
    const { pageCss } = await import("../../src/app/pagesetup");
    expect(pageCss({ orientation: "landscape", marginMm: 20, header: false })).toBe("@page { size: landscape; margin: 20mm; } .print-title { display: none; }");
    const s = importTodoPaperSettings(`settings = "{'spellcheck': True, 'spellcheckLanguage': 'de_DE'}"`);
    expect([s.spellCheck, s.spellCheckLanguage]).toEqual([true, "de-DE"]);
  });
});
