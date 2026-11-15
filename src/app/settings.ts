/**
 * User preferences, persistent app state, built-in themes, CSS generation for
 * themes, and import of an existing TodoPaper configuration. DOM-free so it
 * can be unit tested.
 */

import { PyValue, parseTodoPaperSettings } from "../core/pyliteral";
import { languageTag } from "../core/spelling";
import { DEFAULT_PAGE_SETUP, PageSetup } from "./pagesetup";

export interface TextStyle {
  font: string;
  size: number;
  color: string;
  background: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface Theme {
  name: string;
  background: string;
  notes: TextStyle;
  projects: TextStyle;
  tasks: TextStyle;
  done: TextStyle;
  tags: TextStyle;
  strikeDone: boolean;
  highlightTags: boolean;
  activeLine: boolean;
  activeLineColor: string;
}

/** Style applied to lines containing some text. */
export interface CustomStyle {
  name: string;
  enabled: boolean;
  match: string;
  color: string;
  background: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  wholeLine: boolean;
  size: number;
  font: string;
}

export interface Settings {
  reopenLastFile: boolean;
  autoIndent: boolean;
  wordWrap: boolean;
  showOutline: boolean;
  minimizeToTray: boolean;
  alwaysShowInTray: boolean;
  autoTagDoneDate: boolean;
  inbox: string;
  dateFormat: string;
  defaultTags: string;
  quickLog: boolean;
  quickLogShortcut: string;
  /** TodoPaper "autosave": periodically protect unsaved changes. */
  autoSave: boolean;
  /** "backup": write "name (autosave).ext" every interval (TodoPaper); "file": save the file itself after edits. */
  autoSaveMode: "backup" | "file";
  /** Seconds between backup copies. */
  autoSaveInterval: number;
  /** Reload a file changed on disk without asking when there are no unsaved changes (TodoPaper always asked). */
  reloadSilently: boolean;
  spellCheck: boolean;
  /** Spelling language tag, e.g. "en-US". */
  spellCheckLanguage: string;
  theme: Theme;
  customStyles: CustomStyle[];
}

/** Per-file view state: the search of every view tab and the folded projects. */
export interface FileViews {
  queries: string[];
  active: number;
  folded: string[];
}

export interface AppState {
  /** Window opacity 15..255 (TodoPaper "Window Transparency"). */
  opacity: number;
  /** File > Page Setup. */
  pageSetup: PageSetup;
  recentFiles: string[];
  lastFile: string | null;
  zoom: number;
  outlineWidth: number;
  outlineMode: "projects" | "tags";
  savedSearches: string[];
  views: Record<string, FileViews>;
  imported: boolean;
}

const UI_FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

/** Create a text style with defaults. */
function style(font: string, size: number, color: string, background: string, extra: Partial<TextStyle> = {}): TextStyle {
  return { font, size, color, background, bold: false, italic: false, underline: false, ...extra };
}

export const THEMES: Theme[] = [
  {
    name: "Cetli",
    background: "#FFFFFF",
    notes: style(UI_FONT, 10.5, "#6B7280", "#FFFFFF"),
    projects: style(UI_FONT, 13, "#111827", "#FFFFFF", { bold: true }),
    tasks: style(UI_FONT, 10.5, "#1F2937", "#FFFFFF"),
    done: style(UI_FONT, 10.5, "#A0A7B4", "#FFFFFF"),
    tags: style(UI_FONT, 10, "#C2570C", "#FFF1E6"),
    strikeDone: true,
    highlightTags: false,
    activeLine: true,
    activeLineColor: "#F4F6FA",
  },
  {
    name: "TodoPaper Classic",
    background: "#FFFFFF",
    notes: style("Arial", 10, "#666666", "#FFFFFF"),
    projects: style("Arial", 16, "#000000", "#FFFFFF", { bold: true, underline: true }),
    tasks: style("Arial", 10, "#000000", "#FFFFFF"),
    done: style("Arial", 10, "#888888", "#FFFFFF", { italic: true }),
    tags: style("Arial", 10, "#FF0000", "#FFFFFF", { italic: true }),
    strikeDone: true,
    highlightTags: false,
    activeLine: false,
    activeLineColor: "#F0F0F0",
  },
  {
    name: "TodoPaper Clean",
    background: "#FFFFFF",
    notes: style("Arial", 10, "#666666", "#FFFFFF"),
    projects: style("Arial", 16, "#000000", "#E0E0E0", { bold: true }),
    tasks: style("Arial", 10, "#000000", "#FFFFFF"),
    done: style("Arial", 10, "#888888", "#FFFFFF", { italic: true }),
    tags: style("Arial", 10, "#FF0000", "#FFFFFF", { italic: true }),
    strikeDone: true,
    highlightTags: false,
    activeLine: true,
    activeLineColor: "#F0F0F0",
  },
  {
    name: "TodoPaper Dark",
    background: "#4B4B4B",
    notes: style("Arial", 10, "#A0C6E0", "#4B4B4B"),
    projects: style("Arial", 16, "#FFFFFF", "#45639A", { bold: true }),
    tasks: style("Arial", 10, "#FFFFFF", "#4B4B4B"),
    done: style("Arial", 10, "#888888", "#4B4B4B", { italic: true }),
    tags: style("Arial", 10, "#5BA6D2", "#4B4B4B", { italic: true }),
    strikeDone: true,
    highlightTags: false,
    activeLine: true,
    activeLineColor: "#3C3C3C",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  reopenLastFile: true,
  autoIndent: true,
  wordWrap: true,
  showOutline: false,
  minimizeToTray: false,
  alwaysShowInTray: false,
  autoTagDoneDate: true,
  inbox: "Inbox",
  dateFormat: "%Y-%m-%d",
  defaultTags: "@done, @today, @home, @work",
  quickLog: true,
  quickLogShortcut: "CommandOrControl+Shift+Space",
  autoSave: true,
  autoSaveMode: "backup",
  autoSaveInterval: 60,
  reloadSilently: false,
  spellCheck: false,
  spellCheckLanguage: "en-US",
  theme: THEMES[0],
  customStyles: [],
};

export const DEFAULT_APP_STATE: AppState = {
  opacity: 255,
  pageSetup: DEFAULT_PAGE_SETUP,
  recentFiles: [],
  lastFile: null,
  zoom: 0,
  outlineWidth: 220,
  outlineMode: "projects",
  savedSearches: [],
  views: {},
  imported: false,
};

/** Deep-merge stored JSON over defaults so new settings get default values. */
export function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const base = (defaults as Record<string, unknown>)[key];
    if (base !== null && typeof base === "object" && !Array.isArray(base) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = mergeDefaults(base, value);
    } else if (value !== undefined && (base === undefined || base === null || typeof base === typeof value)) {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Merge this window's app state into the stored one (written by any window):
 * recent files are combined (ours first) unless `replaceRecent`, views are
 * combined per file, everything else comes from `mine`.
 */
export function mergeAppState(stored: AppState, mine: AppState, replaceRecent = false): AppState {
  const recent = replaceRecent ? mine.recentFiles : [...new Set([...mine.recentFiles, ...stored.recentFiles])].slice(0, 10);
  return { ...mine, recentFiles: recent, views: { ...stored.views, ...mine.views } };
}

/** Split the default tags preference into "@tag" names. */
export function defaultTagList(settings: Settings): string[] {
  return settings.defaultTags
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("@") ? t : "@" + t));
}

// ---------------------------------------------------------------- CSS

/** Quote a font family unless it is already a CSS font list. */
function fontFamily(font: string): string {
  if (font.includes(",") || font.includes('"')) return font;
  return `"${font}", ${UI_FONT}`;
}

/** Relative luminance (0..1) of a #RRGGBB color. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True if a theme has a dark background. */
export function isDarkTheme(theme: Theme): boolean {
  return luminance(theme.background) < 0.45;
}

/** CSS declarations for a text style (font size shifted by zoom). */
function fontCss(s: TextStyle, zoom: number, withColor = true): string {
  const parts = [`font-family: ${fontFamily(s.font)}`, `font-size: ${Math.max(5, s.size + zoom)}pt`];
  parts.push(`font-weight: ${s.bold ? "bold" : "normal"}`, `font-style: ${s.italic ? "italic" : "normal"}`);
  if (withColor) parts.push(`color: ${s.color}`);
  return parts.join("; ");
}

/**
 * Vertically center gutter icons on the first visual line of their (possibly
 * wrapped) line: a line box is 1.5 x font size, and 1pt = 4/3 px.
 */
function gutterCss(theme: Theme, zoom: number, subSize: number): string[] {
  const linePx = (pt: number) => Math.max(5, pt + zoom) * 2;
  const offset = (pt: number, icon: number) => Math.max(0, (linePx(pt) - icon) / 2).toFixed(1);
  return [
    `.cm-tp-gutter-open, .cm-tp-gutter-done { margin-top: ${offset(theme.tasks.size, 12)}px; }`,
    `.cm-tp-gutter-expanded { margin-top: ${offset(theme.projects.size, 7)}px; }`,
    `.cm-tp-gutter-folded { margin-top: ${offset(theme.projects.size, 10)}px; }`,
    `.cm-tp-gutter-expanded.cm-tp-gutter-sub { margin-top: ${offset(subSize, 7)}px; }`,
    `.cm-tp-gutter-folded.cm-tp-gutter-sub { margin-top: ${offset(subSize, 10)}px; }`,
  ];
}

/** Generate the editor stylesheet for a theme, zoom level and custom styles. */
export function themeCss(theme: Theme, zoom: number, custom: CustomStyle[]): string {
  const dark = isDarkTheme(theme);
  const subSize = Math.max(theme.projects.size * 0.75, theme.tasks.size);
  const bg = theme.background;
  const projectBg = theme.projects.background.toLowerCase() !== bg.toLowerCase() ? theme.projects.background : "transparent";
  const tagBg = theme.highlightTags ? theme.tags.background : "transparent";
  const lines = [
    `.cm-editor { background-color: ${bg}; color: ${theme.notes.color}; }`,
    `.cm-editor .cm-content { ${fontCss(theme.notes, zoom)}; caret-color: ${dark ? "#F5F5F5" : "#111111"}; }`,
    `.cm-editor .cm-cursor { border-left-color: ${dark ? "#F5F5F5" : "#111111"}; }`,
    `.cm-editor .cm-activeLine { background-color: ${theme.activeLine ? theme.activeLineColor : "transparent"}; }`,
    `.cm-editor .cm-selectionBackground, .cm-editor.cm-focused .cm-selectionBackground { background-color: ${dark ? "#35608F" : "#CFE2FF"} !important; }`,
    `.cm-line.cm-tp-note { ${fontCss(theme.notes, zoom)}; }`,
    `.cm-line.cm-tp-task { ${fontCss(theme.tasks, zoom)}; }`,
    `.cm-line.cm-tp-project { ${fontCss(theme.projects, zoom)}; background-color: ${projectBg}; }`,
    `.cm-line.cm-tp-project-sub { font-size: ${Math.max(5, subSize + zoom)}pt; }`,
    `.cm-line.cm-tp-project .cm-tp-content { text-decoration: ${theme.projects.underline ? "underline" : "none"}; }`,
    `.cm-line.cm-tp-done { ${fontCss(theme.done, zoom)}; }`,
    `.cm-line.cm-tp-done .cm-tp-content { text-decoration: ${theme.strikeDone ? "line-through" : "none"}; text-decoration-color: ${theme.done.color}; }`,
    `.cm-tp-tag { ${fontCss(theme.tags, zoom)}; background-color: ${tagBg}; text-decoration: ${theme.tags.underline ? "underline" : "inherit"}; }`,
    `.cm-tp-link { color: ${dark ? "#8AB4F8" : "#1A5FB4"}; text-decoration: underline; }`,
    `.cm-tp-dash { opacity: 0.55; }`,
    ...gutterCss(theme, zoom, subSize),
  ];
  custom.forEach((c, i) => {
    if (!c.enabled || !c.match) return;
    const decl = [
      `color: ${c.color}`,
      `background-color: ${c.background.toLowerCase() === bg.toLowerCase() ? "transparent" : c.background}`,
      `font-weight: ${c.bold ? "bold" : "normal"}`,
      `font-style: ${c.italic ? "italic" : "normal"}`,
      `text-decoration: ${[c.underline && "underline", c.strike && "line-through"].filter(Boolean).join(" ") || "none"}`,
    ];
    if (c.font) decl.push(`font-family: ${fontFamily(c.font)}`);
    if (c.size) decl.push(`font-size: ${Math.max(5, c.size + zoom)}pt`);
    lines.push(`.cm-tp-custom-${i}, .cm-tp-custom-${i} .cm-tp-content { ${decl.join("; ")}; }`);
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------- TodoPaper import

const WX_BOLD = 92;
const WX_ITALIC = 93;
const OEM_KEYS: Record<number, string> = {
  186: "Semicolon", 187: "Equal", 188: "Comma", 189: "Minus", 190: "Period", 191: "Slash", 192: "Backquote",
  219: "BracketLeft", 220: "Backslash", 221: "BracketRight", 222: "Quote", 226: "IntlBackslash",
};

type PyDict = { [key: string]: PyValue };

/** Convert TodoPaper's [ctrl, alt, shift, keycode] hotkey to a Tauri accelerator string. */
export function hotkeyFromTodoPaper(seq: PyValue): string | null {
  if (!Array.isArray(seq) || seq.length < 4) return null;
  const [ctrl, alt, shift, code] = seq;
  if (typeof code !== "number") return null;
  let key: string | null = null;
  if (code === 32) key = "Space";
  else if (code >= 48 && code <= 57) key = `Digit${code - 48}`;
  else if (code >= 65 && code <= 90) key = String.fromCharCode(code);
  else if (code >= 340 && code <= 363) key = `F${code - 339}`; // wx 2.8 WXK_F1 = 340
  else if (OEM_KEYS[code]) key = OEM_KEYS[code];
  if (!key) return null;
  const mods = [ctrl && "CommandOrControl", alt && "Alt", shift && "Shift"].filter(Boolean);
  return [...mods, key].join("+");
}

/** Convert a TodoPaper style dict ({font, fore, back}) into a TextStyle. */
function textStyleFrom(raw: PyValue, fallback: TextStyle): TextStyle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const d = raw as PyDict;
  const font = (d.font && typeof d.font === "object" && !Array.isArray(d.font) ? d.font : {}) as PyDict;
  return {
    font: typeof font.face === "string" ? font.face : fallback.font,
    size: typeof font.size === "number" ? font.size : fallback.size,
    color: typeof d.fore === "string" ? d.fore : fallback.color,
    background: typeof d.back === "string" ? d.back : fallback.background,
    bold: font.weight === WX_BOLD,
    italic: font.style === WX_ITALIC,
    underline: font.underlined === true,
  };
}

/** Convert TodoPaper's custom style rows into CustomStyle entries. */
function customStylesFrom(rows: PyValue): CustomStyle[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(Array.isArray).map((r) => {
    const row = r as PyValue[];
    return {
      name: String(row[0] ?? "Style"),
      enabled: row[1] === true,
      match: String(row[2] ?? ""),
      color: String(row[3] ?? "#000000"),
      background: String(row[4] ?? "#FFFFFF"),
      bold: row[5] === true,
      italic: row[6] === true,
      underline: row[7] === true,
      strike: row[8] === true,
      wholeLine: row[9] === true,
      size: typeof row[10] === "number" ? row[10] : 0,
      font: typeof row[11] === "string" ? row[11] : "",
    };
  });
}

/** Map a TodoPaper `todopaper.settings` file onto Cetli settings. */
export function importTodoPaperSettings(fileText: string, base: Settings = DEFAULT_SETTINGS): Settings {
  const tp = parseTodoPaperSettings(fileText);
  if (!tp) return base;
  const bool = (key: string, fallback: boolean) => (typeof tp[key] === "boolean" ? (tp[key] as boolean) : fallback);
  const str = (key: string, fallback: string) => (typeof tp[key] === "string" && tp[key] ? (tp[key] as string) : fallback);
  const styles = (tp.default_styles && typeof tp.default_styles === "object" ? tp.default_styles : {}) as PyDict;
  const t = base.theme;
  const notes = textStyleFrom(styles.default_text, t.notes);
  const notesDict = (styles.default_text ?? {}) as PyDict;
  const tagsDict = (styles.tags ?? {}) as PyDict;
  const doneDict = (styles.done_tasks ?? {}) as PyDict;
  const theme: Theme = {
    name: "Imported from TodoPaper",
    background: notes.background,
    notes,
    projects: textStyleFrom(styles.projects, t.projects),
    tasks: textStyleFrom(styles.tasks, t.tasks),
    done: textStyleFrom(styles.done_tasks, t.done),
    tags: textStyleFrom(styles.tags, t.tags),
    strikeDone: doneDict.strikeout !== false,
    highlightTags: tagsDict.highlight === true,
    activeLine: notesDict.caretDraw !== false,
    activeLineColor: typeof notesDict.caret === "string" ? notesDict.caret : t.activeLineColor,
  };
  return {
    ...base,
    reopenLastFile: bool("autoopen", base.reopenLastFile),
    autoIndent: bool("autoindent", base.autoIndent),
    wordWrap: bool("wordwrap", base.wordWrap),
    showOutline: bool("openoutline", base.showOutline),
    minimizeToTray: bool("minimizetotray", base.minimizeToTray),
    alwaysShowInTray: bool("alwaysshowintray", base.alwaysShowInTray),
    autoTagDoneDate: bool("autotagdonedate", base.autoTagDoneDate),
    inbox: str("inbox", base.inbox),
    dateFormat: str("dateformat", base.dateFormat),
    defaultTags: str("defaultTags", base.defaultTags),
    quickLog: bool("quicklog", base.quickLog),
    quickLogShortcut: hotkeyFromTodoPaper(tp.quicklogkeysequence ?? null) ?? base.quickLogShortcut,
    autoSave: bool("autosave", base.autoSave),
    autoSaveMode: "backup",
    autoSaveInterval: typeof tp.autosave_interval === "number" && tp.autosave_interval >= 5000 ? Math.round(tp.autosave_interval / 1000) : base.autoSaveInterval,
    spellCheck: bool("spellcheck", base.spellCheck),
    spellCheckLanguage: languageTag(str("spellcheckLanguage", base.spellCheckLanguage)),
    theme: styles.default_text ? theme : base.theme,
    customStyles: customStylesFrom(tp.styles ?? null),
  };
}
