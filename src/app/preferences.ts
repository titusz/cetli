/**
 * Preferences dialog (General, Appearance, Custom Styles). Changes are
 * previewed live in the editor and reverted on Cancel.
 */

import type { App } from "./app";
import { CustomStyle, Settings, THEMES, TextStyle, Theme } from "./settings";
import { openModal } from "./modal";
import { acceleratorLabel } from "./menu";
import { strftime } from "../core/dates";
import { SPELLING_LANGUAGES } from "../core/spelling";

const FONTS = ["Segoe UI", "Arial", "Calibri", "Consolas", "Courier New", "Georgia", "Helvetica", "Inter", "Menlo", "Monaco", "Roboto", "SF Pro Text", "Tahoma", "Times New Roman", "Ubuntu", "Verdana"];

/** Deep copy JSON-compatible data. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Create an element with a class and optional text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A labelled checkbox bound to a getter/setter. */
function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const wrap = el("label", "pref-check");
  const input = el("input");
  input.type = "checkbox";
  input.checked = get();
  input.onchange = () => set(input.checked);
  wrap.append(input, document.createTextNode(" " + label));
  return wrap;
}

/** A labelled text input bound to a getter/setter. */
function textField(label: string, get: () => string, set: (v: string) => void, extra?: (input: HTMLInputElement) => void): HTMLElement {
  const wrap = el("label", "pref-field");
  wrap.append(el("span", "pref-label", label));
  const input = el("input");
  input.type = "text";
  input.value = get();
  input.oninput = () => set(input.value);
  extra?.(input);
  wrap.appendChild(input);
  return wrap;
}

/** A labelled select bound to a getter/setter; options are [value, label] pairs. */
function selectField(label: string, options: [string, string][], get: () => string, set: (v: string) => void): HTMLElement {
  const wrap = el("label", "pref-field");
  wrap.append(el("span", "pref-label", label));
  const select = el("select");
  const values = options.map(([v]) => v);
  const current = get();
  if (!values.includes(current)) options = [[current, current], ...options];
  for (const [value, text] of options) {
    const o = el("option", "", text);
    o.value = value;
    select.appendChild(o);
  }
  select.value = current;
  select.onchange = () => set(select.value);
  wrap.appendChild(select);
  return wrap;
}

/** Convert a keydown event into a Tauri accelerator ("CommandOrControl+Shift+Space"). */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (!mods.length && !/^F\d+$/.test(e.key)) return null;
  const code = e.code;
  let key = code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code;
  return [...mods, key].join("+");
}

/** Hotkey capture field (shows a readable label, stores the accelerator). */
function hotkeyField(get: () => string, set: (v: string) => void): HTMLElement {
  return textField("Hotkey", () => acceleratorLabel(get()), set, (input) => {
    input.readOnly = true;
    input.dataset.captureKeys = "1";
    input.placeholder = "Press a key combination";
    input.onkeydown = (e) => {
      if (e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Backspace" || e.key === "Delete") {
        input.value = "";
        set("");
        return;
      }
      const acc = acceleratorFromEvent(e);
      if (acc) {
        input.value = acceleratorLabel(acc);
        set(acc);
      }
    };
  });
}

/** Editor for one text style (font, size, colors, bold/italic/underline). */
function styleRow(label: string, s: TextStyle, changed: () => void): HTMLElement {
  const row = el("div", "pref-style-row");
  row.appendChild(el("span", "pref-style-name", label));
  const font = el("input");
  font.type = "text";
  font.value = s.font;
  font.setAttribute("list", "pref-fonts");
  font.title = "Font family";
  font.oninput = () => ((s.font = font.value), changed());
  const size = el("input");
  size.type = "number";
  size.min = "6";
  size.max = "48";
  size.step = "0.5";
  size.value = String(s.size);
  size.title = "Size (pt)";
  size.oninput = () => ((s.size = Number(size.value) || s.size), changed());
  const color = el("input");
  color.type = "color";
  color.value = s.color;
  color.title = "Text color";
  color.oninput = () => ((s.color = color.value), changed());
  const bg = el("input");
  bg.type = "color";
  bg.value = s.background;
  bg.title = "Background color";
  bg.oninput = () => ((s.background = bg.value), changed());
  const toggle = (text: string, title: string, key: "bold" | "italic" | "underline") => {
    const b = el("button", "pref-toggle" + (s[key] ? " on" : ""), text);
    b.type = "button";
    b.title = title;
    b.onclick = () => {
      s[key] = !s[key];
      b.classList.toggle("on", s[key]);
      changed();
    };
    return b;
  };
  row.append(font, size, color, bg, toggle("B", "Bold", "bold"), toggle("I", "Italic", "italic"), toggle("U", "Underline", "underline"));
  return row;
}

/** A labelled color input. */
function colorField(label: string, get: () => string, set: (v: string) => void): HTMLElement {
  const wrap = el("label", "pref-field pref-color");
  wrap.append(el("span", "pref-label", label));
  const input = el("input");
  input.type = "color";
  input.value = get();
  input.oninput = () => set(input.value);
  wrap.appendChild(input);
  return wrap;
}

/** Section heading. */
function heading(text: string): HTMLElement {
  return el("h3", "pref-heading", text);
}

/** Build the General tab. */
/** Spelling languages offered in preferences (installed dictionaries first). */
let spellOptions: [string, string][] = SPELLING_LANGUAGES;

function generalTab(d: Settings, changed: () => void): HTMLElement {
  const p = el("div", "pref-panel");
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => ((d[k] = v), changed());
  const datePreview = el("span", "pref-hint");
  const updateDate = () => (datePreview.textContent = `Today: ${strftime(d.dateFormat || "%Y-%m-%d")}`);
  updateDate();
  p.append(
    heading("Startup and saving"),
    checkbox("Reopen the last file when Cetli starts", () => d.reopenLastFile, set("reopenLastFile")),
    checkbox("Autosave", () => d.autoSave, set("autoSave")),
    selectField(
      "Autosave writes",
      [
        ["backup", "a backup copy, \"name (autosave)\" (TodoPaper)"],
        ["file", "the file itself, right after edits"],
      ],
      () => d.autoSaveMode,
      (v) => ((d.autoSaveMode = v === "file" ? "file" : "backup"), changed()),
    ),
    selectField(
      "Backup every",
      [
        ["30", "30 seconds"],
        ["60", "1 minute"],
        ["120", "2 minutes"],
        ["300", "5 minutes"],
        ["600", "10 minutes"],
      ],
      () => String(d.autoSaveInterval),
      (v) => ((d.autoSaveInterval = Number(v)), changed()),
    ),
    checkbox("Reload files changed on disk without asking (when there are no unsaved changes)", () => d.reloadSilently, set("reloadSilently")),
    heading("Editing"),
    checkbox("Keep indentation on new lines", () => d.autoIndent, set("autoIndent")),
    checkbox("Wrap long lines", () => d.wordWrap, set("wordWrap")),
    checkbox("Check spelling", () => d.spellCheck, set("spellCheck")),
    selectField("Spelling language", spellOptions, () => d.spellCheckLanguage, (v) => ((d.spellCheckLanguage = v), changed())),
    checkbox("Show the outline sidebar", () => d.showOutline, set("showOutline")),
    heading("Tags"),
    textField("Default tags", () => d.defaultTags, set("defaultTags")),
    checkbox("Add the date when tagging @done", () => d.autoTagDoneDate, set("autoTagDoneDate")),
    textField("Date format", () => d.dateFormat, (v) => ((d.dateFormat = v), updateDate(), changed())),
    datePreview,
    heading("Quick Log"),
    checkbox("Open Quick Log with a global hotkey", () => d.quickLog, set("quickLog")),
    hotkeyField(() => d.quickLogShortcut, set("quickLogShortcut")),
    textField("Inbox project", () => d.inbox, set("inbox")),
    heading("System tray"),
    checkbox("Always show Cetli in the system tray", () => d.alwaysShowInTray, set("alwaysShowInTray")),
    checkbox("Closing the window minimizes Cetli instead of quitting", () => d.minimizeToTray, set("minimizeToTray")),
  );
  return p;
}

/** Build the Appearance tab. */
function appearanceTab(d: Settings, changed: () => void, rerender: () => void): HTMLElement {
  const p = el("div", "pref-panel");
  const t = d.theme;
  const preset = el("select");
  const presets: Theme[] = [...THEMES];
  if (!presets.some((x) => x.name === t.name)) presets.unshift(clone(t));
  for (const th of presets) {
    const o = el("option", "", th.name);
    o.value = th.name;
    preset.appendChild(o);
  }
  preset.value = t.name;
  preset.onchange = () => {
    const chosen = presets.find((x) => x.name === preset.value);
    if (chosen) d.theme = clone(chosen);
    changed();
    rerender();
  };
  const presetRow = el("label", "pref-field");
  presetRow.append(el("span", "pref-label", "Theme"), preset);
  const fonts = el("datalist");
  fonts.id = "pref-fonts";
  FONTS.forEach((f) => fonts.appendChild(el("option", "", f)));
  const styleHeader = el("div", "pref-style-row pref-style-header");
  ["", "Font", "Size", "Color", "Back", "", "", ""].forEach((h) => styleHeader.appendChild(el("span", "", h)));
  p.append(
    heading("Theme"),
    presetRow,
    colorField("Editor background", () => t.background, (v) => ((t.background = v), changed())),
    heading("Text styles"),
    fonts,
    styleHeader,
    styleRow("Projects", t.projects, changed),
    styleRow("Tasks", t.tasks, changed),
    styleRow("Notes", t.notes, changed),
    styleRow("Done", t.done, changed),
    styleRow("Tags", t.tags, changed),
    heading("Details"),
    checkbox("Strike out done items", () => t.strikeDone, (v) => ((t.strikeDone = v), changed())),
    checkbox("Highlight tags with their background color", () => t.highlightTags, (v) => ((t.highlightTags = v), changed())),
    checkbox("Highlight the active line", () => t.activeLine, (v) => ((t.activeLine = v), changed())),
    colorField("Active line color", () => t.activeLineColor, (v) => ((t.activeLineColor = v), changed())),
  );
  return p;
}

/** Build the Custom Styles tab. */
function customTab(d: Settings, changed: () => void, rerender: () => void): HTMLElement {
  const p = el("div", "pref-panel");
  p.appendChild(el("p", "pref-hint", "Style lines that contain some text, e.g. \"!!\" or \"@waiting\"."));
  const table = el("div", "pref-custom");
  d.customStyles.forEach((c, i) => {
    const row = el("div", "pref-custom-row");
    const on = el("input");
    on.type = "checkbox";
    on.checked = c.enabled;
    on.title = "Enabled";
    on.onchange = () => ((c.enabled = on.checked), changed());
    const match = el("input");
    match.type = "text";
    match.value = c.match;
    match.placeholder = "Lines containing…";
    match.oninput = () => ((c.match = match.value), changed());
    const color = el("input");
    color.type = "color";
    color.value = c.color;
    color.title = "Text color";
    color.oninput = () => ((c.color = color.value), changed());
    const bg = el("input");
    bg.type = "color";
    bg.value = c.background;
    bg.title = "Background";
    bg.oninput = () => ((c.background = bg.value), changed());
    const flag = (text: string, title: string, key: "bold" | "italic" | "underline" | "strike" | "wholeLine") => {
      const b = el("button", "pref-toggle" + (c[key] ? " on" : ""), text);
      b.type = "button";
      b.title = title;
      b.onclick = () => {
        c[key] = !c[key];
        b.classList.toggle("on", c[key]);
        changed();
      };
      return b;
    };
    const del = el("button", "pref-delete", "Remove");
    del.type = "button";
    del.onclick = () => {
      d.customStyles.splice(i, 1);
      changed();
      rerender();
    };
    row.append(on, match, color, bg, flag("B", "Bold", "bold"), flag("I", "Italic", "italic"), flag("U", "Underline", "underline"), flag("S", "Strike out", "strike"), flag("Line", "Style the whole line", "wholeLine"), del);
    table.appendChild(row);
  });
  const add = el("button", "", "Add Style");
  add.type = "button";
  add.onclick = () => {
    const blank: CustomStyle = { name: "Style", enabled: true, match: "", color: "#B00020", background: d.theme.background, bold: true, italic: false, underline: false, strike: false, wholeLine: false, size: 0, font: "" };
    d.customStyles.push(blank);
    rerender();
  };
  p.append(table, add);
  return p;
}

/** Open the preferences dialog. */
export async function showPreferences(app: App): Promise<void> {
  const installed = await app.platform.spellLanguages();
  const labels = new Map(SPELLING_LANGUAGES);
  spellOptions = installed.length ? installed.map((tag): [string, string] => [tag, labels.get(tag) ?? tag]) : SPELLING_LANGUAGES;
  const original = clone(app.settings);
  const draft = clone(app.settings);
  const body = el("div", "prefs");
  const tabs = el("div", "pref-tabs");
  const content = el("div", "pref-content");
  const names = ["General", "Appearance", "Custom Styles"];
  let current = 0;
  const changed = () => {
    app.settings = draft;
    app.applySettings();
  };
  const render = () => {
    tabs.innerHTML = "";
    names.forEach((n, i) => {
      const b = el("button", "pref-tab" + (i === current ? " active" : ""), n);
      b.type = "button";
      b.onclick = () => {
        current = i;
        render();
      };
      tabs.appendChild(b);
    });
    content.innerHTML = "";
    const panel = current === 0 ? generalTab(draft, changed) : current === 1 ? appearanceTab(draft, changed, render) : customTab(draft, changed, render);
    content.appendChild(panel);
  };
  render();
  body.append(tabs, content);
  const result = await openModal(body, [
    { id: "cancel", label: "Cancel" },
    { id: "ok", label: "OK", primary: true },
  ], { title: "Preferences", wide: true });
  if (result === "ok") {
    app.settings = draft;
    await app.saveSettings();
    if (app.primary) await app.registerHotkey();
    app.announceSettings();
  } else {
    app.settings = original;
  }
  app.applySettings();
}
