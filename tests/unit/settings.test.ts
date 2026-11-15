/** Tests for the Python-literal parser, TodoPaper settings import and theme CSS. */

import { describe, expect, test } from "vitest";
import { parsePyLiteral, parseTodoPaperSettings } from "../../src/core/pyliteral";
import { DEFAULT_SETTINGS, THEMES, defaultTagList, hotkeyFromTodoPaper, importTodoPaperSettings, isDarkTheme, mergeDefaults, themeCss } from "../../src/app/settings";

// A real-world TodoPaper 1.1.5 settings file (structure as written by the app).
const TP_SETTINGS = `settings = "{'styles': [[u'twarp', False, u'#', u'#000000', u'#FFFFFF', False, False, False, False, True, 12, u'ms shell dlg']], 'openoutline': False, 'autosave_interval': 60000, 'spellcheck': False, 'default_styles': {'tasks': {'font': {'underlined': False, 'size': 11, 'style': 90, 'weight': 90, 'face': u'Consolas'}, 'back': u'#FFFFFF', 'fore': u'#000000'}, 'default_text': {'caret': u'#F0F0F0', 'caretDraw': True, 'font': {'underlined': False, 'size': 11, 'style': 90, 'weight': 90, 'face': u'Consolas'}, 'back': u'#FFFFFF', 'fore': u'#666666'}, 'done_tasks': {'strikeout': True, 'font': {'underlined': False, 'size': 11, 'style': 93, 'weight': 90, 'face': u'Consolas'}, 'back': u'#FFFFFF', 'fore': u'#888888'}, 'projects': {'font': {'underlined': True, 'size': 11, 'style': 90, 'weight': 92, 'face': u'Consolas'}, 'back': u'#FFFFFF', 'fore': u'#000000'}, 'tags': {'highlight': False, 'font': {'underlined': False, 'size': 11, 'style': 93, 'weight': 90, 'face': u'Consolas'}, 'back': u'#FFFFFF', 'fore': u'#FF8040'}}, 'quicklogkeysequence': [True, False, False, 226], 'dateformat': u'%Y-%m-%d', 'autotagdonedate': True, 'alwaysshowintray': False, 'autosave': True, 'minimizetotray': False, 'autoopen': True, 'defaultTags': u'@done, @today, @home, @work', 'wordwrap': True, 'autoindent': True, 'quicklog': True, 'autoupdate': False, 'spellcheckLanguage': 'en_US', 'inbox': u'Inbox'}"`;

describe("parsePyLiteral", () => {
  test("scalars, strings and containers", () => {
    expect(parsePyLiteral("{'a': [1, 2.5, -3], u'b': (True, False, None), \"c\": 'it\\'s'}")).toEqual({
      a: [1, 2.5, -3],
      b: [true, false, null],
      c: "it's",
    });
  });

  test("unicode escapes and trailing commas", () => {
    expect(parsePyLiteral("[u'\\u2007x', 'a\\nb',]")).toEqual([" x", "a\nb"]);
  });

  test("malformed input throws, settings parser returns null", () => {
    expect(() => parsePyLiteral("{'a': }")).toThrow();
    expect(parseTodoPaperSettings("garbage")).toBeNull();
  });
});

describe("TodoPaper import", () => {
  const s = importTodoPaperSettings(TP_SETTINGS);

  test("behaviour preferences", () => {
    expect(s.reopenLastFile).toBe(true);
    expect(s.inbox).toBe("Inbox");
    expect(s.dateFormat).toBe("%Y-%m-%d");
    expect(s.defaultTags).toBe("@done, @today, @home, @work");
    expect(s.quickLogShortcut).toBe("CommandOrControl+IntlBackslash");
  });

  test("styles become an imported theme", () => {
    expect(s.theme.name).toBe("Imported from TodoPaper");
    expect(s.theme.projects).toMatchObject({ font: "Consolas", size: 11, bold: true, underline: true, color: "#000000" });
    expect(s.theme.tags).toMatchObject({ color: "#FF8040", italic: true });
    expect(s.theme.done).toMatchObject({ color: "#888888", italic: true });
    expect(s.theme.strikeDone).toBe(true);
    expect(s.theme.activeLineColor).toBe("#F0F0F0");
  });

  test("custom styles", () => {
    expect(s.customStyles).toEqual([
      { name: "twarp", enabled: false, match: "#", color: "#000000", background: "#FFFFFF", bold: false, italic: false, underline: false, strike: false, wholeLine: true, size: 12, font: "ms shell dlg" },
    ]);
  });

  test("hotkey conversion", () => {
    expect(hotkeyFromTodoPaper([true, false, false, 32])).toBe("CommandOrControl+Space");
    expect(hotkeyFromTodoPaper([true, true, true, 76])).toBe("CommandOrControl+Alt+Shift+L");
    expect(hotkeyFromTodoPaper([false, false, false, 341])).toBe("F2");
    expect(hotkeyFromTodoPaper([true, false, false, 9999])).toBeNull();
  });

  test("unreadable file leaves defaults", () => {
    expect(importTodoPaperSettings("nope")).toBe(DEFAULT_SETTINGS);
  });
});

describe("settings helpers", () => {
  test("mergeDefaults keeps new defaults and ignores wrong types", () => {
    const merged = mergeDefaults(DEFAULT_SETTINGS, { inbox: "Eingang", wordWrap: "yes", theme: { background: "#000000" } });
    expect(merged.inbox).toBe("Eingang");
    expect(merged.wordWrap).toBe(true);
    expect(merged.theme.background).toBe("#000000");
    expect(merged.theme.projects.bold).toBe(true);
  });

  test("defaultTagList", () => {
    expect(defaultTagList({ ...DEFAULT_SETTINGS, defaultTags: "@done, today  work" })).toEqual(["@done", "@today", "@work"]);
  });

  test("dark detection and css output", () => {
    expect(isDarkTheme(THEMES[3])).toBe(true);
    expect(isDarkTheme(THEMES[0])).toBe(false);
    const css = themeCss(THEMES[1], 2, [{ ...DEFAULT_SETTINGS.customStyles[0], name: "x", enabled: true, match: "!", color: "#FF0000", background: "#FFFFFF", bold: true, italic: false, underline: false, strike: true, wholeLine: false, size: 0, font: "" }]);
    expect(css).toContain("font-size: 18pt");
    expect(css).toContain(".cm-tp-custom-0");
    expect(css).toContain("line-through");
  });
});
