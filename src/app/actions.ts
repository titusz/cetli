/**
 * The action registry: every user command with its label and shortcut(s).
 * Menus, key bindings and the shortcut reference are generated from it.
 * Shortcuts follow TodoPaper where possible (Mod = Ctrl, or Cmd on macOS).
 */

import type { App } from "./app";
import * as cmd from "../editor/commands";
import { MenuItem, SEPARATOR, keyLabel } from "./menu";
import { showPreferences } from "./preferences";
import { showAbout, showDebugInfo, showDocumentation, showShortcuts } from "./help";
import { showPageSetup } from "./pagesetup";
import { showConsole } from "./console";

export interface Action {
  id: string;
  label: string;
  keys?: string[];
  run: (app: App) => void | Promise<void>;
  enabled?: (app: App) => boolean;
  checked?: (app: App) => boolean;
}

/** Shorthand for actions that run an editor state command on the selected lines. */
const onLines = (fn: (app: App, lines: number[]) => void) => (app: App) => fn(app, app.selectedLines());

export const ACTIONS: Action[] = [
  // File
  { id: "new", label: "New", keys: ["Mod-n"], run: (a) => a.newFile() },
  { id: "newView", label: "New View", keys: ["Mod-Alt-t"], run: (a) => a.newView() },
  { id: "newWindow", label: "New Window", keys: ["Mod-Alt-n"], run: (a) => a.newWindow() },
  { id: "open", label: "Open…", keys: ["Mod-o"], run: (a) => a.openFile() },
  { id: "reload", label: "Reload File from Disk", run: (a) => a.reload(), enabled: (a) => a.path !== null },
  { id: "close", label: "Close", keys: ["Mod-w"], run: (a) => a.closeViewOrFile() },
  { id: "save", label: "Save", keys: ["Mod-s"], run: async (a) => void (await a.save()) },
  { id: "saveAs", label: "Save As…", keys: ["Mod-Shift-s"], run: async (a) => void (await a.saveAs()) },
  { id: "pageSetup", label: "Page Setup…", run: (a) => showPageSetup(a) },
  { id: "print", label: "Print…", run: (a) => a.print() },
  { id: "quit", label: "Exit", keys: ["Mod-q"], run: (a) => a.quit() },
  // Edit
  { id: "undo", label: "Undo", run: (a) => a.undo() },
  { id: "redo", label: "Redo", run: (a) => a.redo() },
  { id: "cut", label: "Cut", run: (a) => a.copy(true) },
  { id: "cutLine", label: "Cut Line", keys: ["Mod-k"], run: (a) => a.cutLine() },
  { id: "copy", label: "Copy", run: (a) => a.copy() },
  { id: "paste", label: "Paste", run: (a) => a.paste() },
  { id: "selectAll", label: "Select All", run: (a) => a.selectAll() },
  { id: "selectLine", label: "Select Line", keys: ["Alt-s"], run: (a) => a.run(cmd.selectLine) },
  { id: "selectHierarchy", label: "Select Hierarchy", keys: ["Alt-h"], run: (a) => a.run(cmd.selectHierarchy) },
  { id: "search", label: "Search…", keys: ["Mod-Alt-s", "Mod-e"], run: (a) => a.focusSearch() },
  { id: "find", label: "Find and Replace…", keys: ["Mod-f"], run: (a) => a.openFind() },
  { id: "preferences", label: "Preferences…", keys: ["Mod-;"], run: (a) => showPreferences(a) },
  // View
  { id: "outline", label: "Show Document Outline", keys: ["Alt-o"], run: (a) => a.toggleOutline(), checked: (a) => a.outlineVisible },
  { id: "prevProject", label: "Jump to Previous Project", keys: ["Mod-PageUp"], run: (a) => a.run((s) => cmd.jumpToProject(s, -1)) },
  { id: "nextProject", label: "Jump to Next Project", keys: ["Mod-PageDown"], run: (a) => a.run((s) => cmd.jumpToProject(s, 1)) },
  { id: "expandAll", label: "Expand All Projects", keys: ["Mod-,", "Mod-<"], run: (a) => a.foldAll(false) },
  { id: "collapseAll", label: "Collapse All Projects", keys: ["Mod-.", "Mod->"], run: (a) => a.foldAll(true) },
  { id: "toggleFold", label: "Fold/Unfold Current Project", keys: ["Mod-m"], run: (a) => a.run(cmd.toggleCurrentFold) },
  { id: "hideDone", label: "Hide Done Tasks", keys: ["Mod-h"], run: (a) => a.toggleHideDone(), checked: (a) => a.hidingDone },
  { id: "prevView", label: "Previous View", keys: ["Mod-Shift-Tab"], run: (a) => a.nextView(-1), enabled: (a) => a.tabs.length > 1 },
  { id: "nextView", label: "Next View", keys: ["Mod-Tab"], run: (a) => a.nextView(1), enabled: (a) => a.tabs.length > 1 },
  { id: "closeView", label: "Close View", run: (a) => a.closeView(), enabled: (a) => a.activeTab > 0 },
  { id: "zoomIn", label: "Increase Font Size", keys: ["Mod-=", "Mod-+"], run: (a) => a.zoom(1) },
  { id: "zoomOut", label: "Decrease Font Size", keys: ["Mod--"], run: (a) => a.zoom(-1) },
  { id: "zoomReset", label: "Reset Font Size", keys: ["Mod-0"], run: (a) => a.zoom(0) },
  { id: "opacityUp", label: "Less Transparent", keys: ["Mod-Shift-0"], run: (a) => a.changeOpacity(15) },
  { id: "opacityDown", label: "More Transparent", keys: ["Mod-Shift-9"], run: (a) => a.changeOpacity(-15) },
  { id: "opacityReset", label: "Reset Transparency", keys: ["Mod-Shift-8"], run: (a) => a.changeOpacity(0) },
  {
    id: "wordWrap",
    label: "Word Wrap",
    run: (a) => {
      a.settings.wordWrap = !a.settings.wordWrap;
      a.applySettings();
      void a.saveSettings();
    },
    checked: (a) => a.settings.wordWrap,
  },
  // Tools
  { id: "newProject", label: "New Project", keys: ["Mod-p"], run: (a) => a.run(cmd.newProject) },
  { id: "newTask", label: "New Task", keys: ["Mod-t"], run: (a) => a.run(cmd.newTask) },
  { id: "newTag", label: "New Tag", keys: ["Mod-g"], run: (a) => a.newTag() },
  { id: "moveUp", label: "Move Line Up", keys: ["Mod-ArrowUp"], run: (a) => a.run((s) => cmd.moveLines(s, -1)) },
  { id: "moveDown", label: "Move Line Down", keys: ["Mod-ArrowDown"], run: (a) => a.run((s) => cmd.moveLines(s, 1)) },
  { id: "moveTreeUp", label: "Move Line and Children Up", keys: ["Mod-Alt-ArrowUp"], run: (a) => a.run((s) => cmd.moveLines(s, -1, true)) },
  { id: "moveTreeDown", label: "Move Line and Children Down", keys: ["Mod-Alt-ArrowDown"], run: (a) => a.run((s) => cmd.moveLines(s, 1, true)) },
  { id: "tagDone", label: "Tag Done", keys: ["Mod-d"], run: onLines((a, l) => a.run((s) => cmd.toggleDoneLines(s, l))) },
  { id: "tagDate", label: "Tag Date", keys: ["Mod-u"], run: onLines((a, l) => a.run((s) => cmd.toggleTagLines(s, l, "date", cmd.today(s)))) },
  { id: "tagToday", label: "Tag Today", keys: ["Mod-y"], run: onLines((a, l) => a.run((s) => cmd.toggleTagLines(s, l, "today"))) },
  ...Array.from({ length: 9 }, (_, i): Action => ({
    id: `priority${i + 1}`,
    label: `Priority ${i + 1}`,
    keys: [`Mod-${i + 1}`],
    run: onLines((a, l) => a.run((s) => cmd.toggleTagLines(s, l, "priority", String(i + 1)))),
  })),
  { id: "bold", label: "Bold", keys: ["Mod-b"], run: (a) => a.run(cmd.boldSelection) },
  { id: "archiveLines", label: "Archive Selected Lines", keys: ["Mod-Shift-a"], run: onLines((a, l) => a.run((s) => cmd.archiveLines(s, l))) },
  { id: "archiveDone", label: "Archive Done Tasks", keys: ["Mod-Shift-d"], run: (a) => a.run(cmd.archiveDone) },
  { id: "searchBack", label: "Back", keys: ["Alt-ArrowLeft"], run: (a) => a.searchHistory(-1), enabled: (a) => a.canSearchHistory(-1) },
  { id: "searchForward", label: "Forward", keys: ["Alt-ArrowRight"], run: (a) => a.searchHistory(1), enabled: (a) => a.canSearchHistory(1) },
  { id: "resetSearch", label: "Reset Search", keys: ["Mod-r"], run: (a) => a.resetSearch() },
  { id: "refreshSearch", label: "Refresh Search Results", keys: ["F5"], run: (a) => a.refreshSearch() },
  { id: "quickLog", label: "Quick Log…", keys: ["Mod-l"], run: (a) => a.openQuickLog() },
  { id: "console", label: "Console…", keys: ["Mod-`", "Mod-Shift-F2"], run: (a) => showConsole(a) },
  { id: "reloadPlugins", label: "Reload Plugins", run: (a) => a.reloadPlugins() },
  { id: "pluginsFolder", label: "Open Plugins Folder", run: (a) => a.openPluginsFolder() },
  // Help
  { id: "documentation", label: "Documentation", run: () => showDocumentation() },
  { id: "shortcuts", label: "Keyboard Shortcuts", keys: ["F1"], run: () => showShortcuts() },
  { id: "about", label: "About Cetli", run: () => showAbout() },
  { id: "debugInfo", label: "Show Debug Information", keys: ["Mod-Shift-F10"], run: (a) => showDebugInfo(a) },
];

const byId = new Map(ACTIONS.map((a) => [a.id, a]));

/** Menu item for an action (label, first shortcut, enabled and checked state). */
export function actionMenuItem(app: App, id: string, label?: string): MenuItem {
  const a = byId.get(id);
  if (!a) throw new Error(`Unknown action ${id}`);
  const fixed: Record<string, string> = { undo: "Mod-z", redo: "Mod-Shift-z", cut: "Mod-x", copy: "Mod-c", paste: "Mod-v", selectAll: "Mod-a" };
  return {
    label: label ?? a.label,
    shortcut: keyLabel(a.keys?.[0] ?? fixed[id]),
    enabled: a.enabled ? a.enabled(app) : true,
    checked: a.checked ? a.checked(app) : undefined,
    action: () => app.runAction(a),
  };
}

/** Tools > Plugins: one submenu per plugin, then console and plugin management. */
function pluginsMenu(app: App): MenuItem[] {
  const items: MenuItem[] = app.plugins.map((p) => {
    if (p.error) return { label: `${p.name} (failed to load)`, enabled: false };
    const sub = p.items.map((it) => ({ label: it.label, shortcut: keyLabel(it.key), action: () => it.run() }));
    return sub.length ? { label: p.name, submenu: sub } : { label: p.name, enabled: false };
  });
  if (!items.length) items.push({ label: "No plugins installed", enabled: false });
  items.push(SEPARATOR, actionMenuItem(app, "console"), actionMenuItem(app, "reloadPlugins"), actionMenuItem(app, "pluginsFolder"));
  return items;
}

export interface MenuDef {
  label: string;
  items: (app: App) => MenuItem[];
}

/** Build menu items from action ids ("-" for separators, objects for submenus). */
function build(app: App, spec: (string | MenuItem | { label: string; ids: string[] })[]): MenuItem[] {
  return spec.map((s) => {
    if (s === "-") return SEPARATOR;
    if (typeof s === "string") return actionMenuItem(app, s);
    if ("ids" in s) return { label: s.label, submenu: build(app, s.ids) };
    return s;
  });
}

export const MENUS: MenuDef[] = [
  {
    label: "File",
    items: (a) => build(a, ["new", "newView", "newWindow", "open", { label: "Open Recent", submenu: a.recentMenu() }, "-", "reload", "close", "-", "save", "saveAs", "-", "pageSetup", "print", "-", "quit"]),
  },
  {
    label: "Edit",
    items: (a) => build(a, ["undo", "redo", "-", "cut", "cutLine", "copy", "paste", "-", "selectAll", "selectLine", "selectHierarchy", "-", "search", "find", "-", "preferences"]),
  },
  {
    label: "View",
    items: (a) =>
      build(a, [
        "outline",
        "-",
        { label: "Projects", ids: ["prevProject", "nextProject", "-", "expandAll", "collapseAll", "-", "toggleFold"] },
        { label: "Tasks", ids: ["hideDone"] },
        { label: "Views", ids: ["newView", "prevView", "nextView", "closeView"] },
        "-",
        { label: "Window Transparency", ids: ["opacityUp", "opacityDown", "opacityReset"] },
        { label: "Font Size", ids: ["zoomIn", "zoomOut", "zoomReset"] },
        "wordWrap",
      ]),
  },
  {
    label: "Tools",
    items: (a) =>
      build(a, [
        "newProject",
        "newTask",
        "newTag",
        "-",
        { label: "Move Lines", ids: ["moveUp", "moveDown", "-", "moveTreeUp", "moveTreeDown"] },
        "-",
        "tagDone",
        "tagDate",
        "tagToday",
        { label: "Tag Priority", ids: Array.from({ length: 9 }, (_, i) => `priority${i + 1}`) },
        "bold",
        "-",
        { label: "Archive", ids: ["archiveLines", "archiveDone"] },
        "-",
        { label: "Search History", ids: ["searchBack", "searchForward"] },
        "resetSearch",
        "refreshSearch",
        "-",
        "quickLog",
        "-",
        { label: "Plugins", submenu: pluginsMenu(a) },
      ]),
  },
  { label: "Help", items: (a) => build(a, ["documentation", "shortcuts", "-", "about", "debugInfo"]) },
];
