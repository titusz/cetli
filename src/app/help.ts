/** Help dialogs: keyboard shortcut reference and About. */

import type { App } from "./app";
import { runningPython } from "./python";
import { ACTIONS } from "./actions";
import { logEntries } from "./debuglog";
import { keyLabel } from "./menu";
import { openModal } from "./modal";

const EXTRA_KEYS: [string, string][] = [
  ["Enter", "New task after a task; on a project line start its first task"],
  ["Shift+Enter", "New task below, wherever the cursor is"],
  ["Ctrl+Enter", "Plain new line (no task marker)"],
  ["Enter on an empty task", "Outdent it, or clear it at the top level"],
  ["Tab / Shift+Tab", "Indent / outdent the selected lines"],
  ["@", "Tag autocompletion (Tab or Enter to accept)"],
  ["Ctrl+click a tag", "Add or remove the tag in the search"],
  ["Ctrl+click a project", "Show only that project"],
  ["Ctrl+click a link", "Open it"],
  ["Click a checkbox", "Mark the task done / not done"],
  ["Click a project arrow", "Fold / unfold the project"],
  ["Escape", "Clear the search; otherwise close Cetli (or hide it to the tray)"],
  ["Drop files onto the text", "Insert file:/// links to them"],
];

const SEARCH_HELP: [string, string][] = [
  ["word @tag", "Lines containing all terms (case-insensitive)"],
  ["<Project Name>", "Only lines of that project"],
  ["NOT @done", "Exclude lines with @done (also: ! term); stays active for following terms"],
  ["a OR b", "Lines with either term (also: a | b); AND switches back"],
  ['"two words"', "An exact phrase"],
];

/** Build a two-column table. */
function table(rows: [string, string][], cls = ""): HTMLTableElement {
  const t = document.createElement("table");
  t.className = "help-table " + cls;
  for (const [a, b] of rows) {
    const tr = t.insertRow();
    const k = tr.insertCell();
    k.textContent = a;
    k.className = "help-key";
    tr.insertCell().textContent = b;
  }
  return t;
}

/** Show the keyboard shortcut reference. */
export function showShortcuts(): void {
  const body = document.createElement("div");
  body.className = "help";
  const commands = ACTIONS.filter((a) => a.keys?.length).map((a): [string, string] => [a.keys!.map(keyLabel).join(", "), a.label.replace(/…$/, "")]);
  const h = (text: string) => {
    const el = document.createElement("h3");
    el.textContent = text;
    return el;
  };
  body.append(h("Commands"), table(commands), h("Editing"), table(EXTRA_KEYS), h("Search syntax"), table(SEARCH_HELP));
  void openModal(body, [{ id: "ok", label: "Close", primary: true }], { title: "Keyboard Shortcuts", wide: true });
}

/** Show the About dialog. */
export function showAbout(): void {
  const body = document.createElement("div");
  body.className = "about";
  body.innerHTML = `
    <p><strong>Cetli</strong> 0.1.0 — plain-text todo lists.</p>
    <p>A free, open source, cross-platform reimplementation of the much-loved
    <em>TodoPaper</em> desktop app by Widefido, using the TaskPaper file format.</p>
    <p>"Cetli" is Hungarian for a slip of paper.</p>
    <p class="muted">Built with Tauri and CodeMirror. MIT licensed.</p>`;
  void openModal(body, [{ id: "ok", label: "OK", primary: true }], { title: "About Cetli" });
}

const GUIDE: [string, [string, string][]][] = [
  ["The file", [
    ["Project:", "A line ending with a colon (tags may follow). Everything up to the next project belongs to it."],
    ["- Task", "A line starting with a dash and a space. Click its checkbox or press Ctrl+D to mark it @done."],
    ["Note", "Any other line."],
    ["@tag @tag(value)", "Tags anywhere in a line; values contain no spaces. @done(date) marks finished items."],
  ]],
  ["Working with lists", [
    ["Search box", "Filters the list as you type; see the search syntax under Keyboard Shortcuts. Enter saves a search."],
    ["Views", "Ctrl+Alt+T opens another tab on the same file with its own search."],
    ["Outline", "Alt+O shows projects or tags; click to jump, double-click to filter."],
    ["Archive", "Ctrl+Shift+D moves @done items under Archive: as @archive(Project)."],
    ["Quick Log", "The global hotkey (Preferences) adds an item to your Inbox from anywhere."],
  ]],
  ["Saving", [
    ["Ctrl+S", "Saves the file. Autosave keeps a backup copy, name (autosave).ext, and offers it after a crash."],
    ["Preferences", "Autosave can also save the file itself, and files changed on disk can reload without asking."],
  ]],
  ["Extending", [
    ["Plugins", "JavaScript and TodoPaper Python plugins in the plugins folder add commands under Tools > Plugins."],
    ["Console", "Ctrl+` runs Python with self as the editor, as in TodoPaper (print(self.GetLineCount())), or JavaScript with the plugin API as cetli."],
  ]],
];

/** Help > Documentation: an in-app user guide. */
export function showDocumentation(): void {
  const body = document.createElement("div");
  body.className = "help";
  for (const [title, rows] of GUIDE) {
    const h = document.createElement("h3");
    h.textContent = title;
    body.append(h, table(rows));
  }
  void openModal(body, [{ id: "ok", label: "Close", primary: true }], { title: "Cetli Documentation", wide: true });
}

/** Help > Show Debug Information: environment, document details and the error log. */
export async function showDebugInfo(app: App): Promise<void> {
  const rows: [string, string][] = [
    ["Version", "Cetli 0.1.0"],
    ["Platform", `${app.platform.kind} · ${navigator.userAgent}`],
    ["Window", `${app.platform.windowLabel}${app.primary ? " (primary)" : ""}`],
    ["Document", app.path ?? "Untitled"],
    ["File format", `${app.meta.encoding}${app.meta.bom ? " with BOM" : ""}, ${app.meta.lineEnding === "\r\n" ? "CRLF" : app.meta.lineEnding === "\r" ? "CR" : "LF"}`],
    ["Lines", String(app.view.state.doc.lines)],
    ["Configuration", (await app.platform.configDir()) ?? "browser storage"],
    ["Plugins", app.plugins.map((p) => `${p.name}${p.error ? " (failed)" : ""}`).join(", ") || "none"],
    ["Python", (await runningPython(app))?.description ?? "not started"],
  ];
  const body = document.createElement("div");
  body.className = "help";
  const h = document.createElement("h3");
  h.textContent = "Log";
  const log = document.createElement("pre");
  log.className = "debug-log";
  const entries = logEntries();
  log.textContent = entries.length ? entries.map((e) => `${e.time} ${e.level.toUpperCase()} ${e.message}`).join("\n") : "No warnings or errors.";
  body.append(table(rows), h, log);
  void openModal(body, [{ id: "ok", label: "Close", primary: true }], { title: "Debug Information", wide: true });
}
