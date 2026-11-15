/**
 * JavaScript plugins, Cetli's counterpart of TodoPaper's Python plugins.
 *
 * A plugin is an ES module file (*.js) in Cetli's plugins folder whose default
 * export receives a plugin API:
 *
 *   export default function (cetli) {
 *     cetli.addMenuItem("Insert Timestamp", () => cetli.insertText(new Date().toISOString()), "Mod-Alt-d");
 *     cetli.onTagChange("@today", (e) => cetli.toast(`${e.added ? "added" : "removed"} on line ${e.line}`));
 *     cetli.onStart(() => {});
 *   }
 *
 * Like TodoPaper, plugins contribute menu items (Tools > Plugins > name, with
 * optional shortcuts), run code when Cetli starts ("on_start") and react to
 * tags being added to or removed from lines. Modules are loaded from blob:
 * URLs so the content security policy never needs to allow eval.
 */

import { EditorSelection, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { App } from "./app";
import { getOutline } from "../editor/model";
import * as cmd from "../editor/commands";
import { toast } from "./modal";
import { undoGroupReplay } from "../editor/undogroup";

export interface PluginMenuItem {
  label: string;
  key?: string;
  run: () => void;
}

export interface TagChange {
  tag: string;
  line: number;
  text: string;
  added: boolean;
}

export interface LoadedPlugin {
  name: string;
  path: string;
  items: PluginMenuItem[];
  error?: string;
}

/** Hooks registered by plugins. */
export interface PluginHooks {
  start: (() => void)[];
  tags: Map<string, ((e: TagChange) => void)[]>;
}

/** The API object handed to plugins and the console. */
export interface PluginApi {
  name: string;
  view: EditorView;
  app: App;
  addMenuItem(label: string, run: () => void, key?: string): void;
  onStart(fn: () => void): void;
  onTagChange(tag: string, fn: (e: TagChange) => void): void;
  getText(): string;
  setText(text: string): void;
  lineCount(): number;
  getLine(n: number): string;
  replaceLine(n: number, text: string): void;
  insertText(text: string): void;
  selectedLines(): number[];
  addToProject(text: string, project: string): void;
  search(query: string): void;
  runAction(id: string): void;
  toast(message: string): void;
}

/** Create the API for one plugin (or the console). */
export function createApi(app: App, plugin: LoadedPlugin, hooks: PluginHooks): PluginApi {
  const view = app.view;
  return {
    name: plugin.name,
    view,
    app,
    addMenuItem: (label, run, key) => plugin.items.push({ label, run, key }),
    onStart: (fn) => hooks.start.push(fn),
    onTagChange: (tag, fn) => {
      const key = "@" + tag.replace(/^@/, "").toLowerCase();
      hooks.tags.set(key, [...(hooks.tags.get(key) ?? []), fn]);
    },
    getText: () => app.view.state.doc.toString(),
    setText: (text) => app.view.dispatch({ changes: { from: 0, to: app.view.state.doc.length, insert: text } }),
    lineCount: () => app.view.state.doc.lines,
    getLine: (n) => app.view.state.doc.line(n).text,
    replaceLine: (n, text) => {
      const line = app.view.state.doc.line(n);
      app.view.dispatch({ changes: { from: line.from, to: line.to, insert: text } });
    },
    insertText: (text) => {
      const { from, to } = app.view.state.selection.main;
      app.view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length) });
    },
    selectedLines: () => cmd.selectedLines(app.view.state),
    addToProject: (text, project) => app.dispatch(cmd.addToProject(app.view.state, text, project)),
    search: (query) => app.setSearch(query, { commit: true }),
    runAction: (id) => app.runAction(id),
    toast: (message) => toast(message),
  };
}

/** File name without folders and the .js extension. */
function pluginName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/(\.cetli-plugin)?\.js$/i, "");
}

/** Import JavaScript module source via a blob: URL. */
export async function importModule(code: string): Promise<{ default?: unknown; name?: unknown }> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Load and initialize all plugins from the given sources. */
export async function loadPlugins(app: App, sources: { path: string; code: string }[], hooks: PluginHooks): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  for (const { path, code } of sources) {
    const plugin: LoadedPlugin = { name: pluginName(path), path, items: [] };
    try {
      const mod = await importModule(code);
      if (typeof mod.name === "string" && mod.name.trim()) plugin.name = mod.name.trim();
      if (typeof mod.default !== "function") throw new Error("the module has no default export function");
      await (mod.default as (api: PluginApi) => unknown)(createApi(app, plugin, hooks));
    } catch (err) {
      plugin.error = String(err);
      console.warn(`Plugin ${path} failed to load`, err);
      toast(`Plugin file (${plugin.name}) failed to load`);
    }
    loaded.push(plugin);
  }
  return loaded;
}

/** Count tag names ("@name", lower case) over a list of tag-name arrays. */
function countTags(lists: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of lists) for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Report tags added to or removed from the lines a transaction changed. */
export function detectTagChanges(tr: Transaction, hooks: PluginHooks): TagChange[] {
  if (!tr.docChanged || hooks.tags.size === 0 || tr.annotation(undoGroupReplay)) return [];
  const before = getOutline(tr.startState);
  const after = getOutline(tr.state);
  const events: TagChange[] = [];
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const a1 = tr.startState.doc.lineAt(fromA).number, a2 = tr.startState.doc.lineAt(toA).number;
    const b1 = tr.state.doc.lineAt(fromB).number, b2 = tr.state.doc.lineAt(toB).number;
    const tagsOf = (infos: typeof before.infos, n: number) => infos[n - 1]?.tags.map((t) => "@" + t.name.toLowerCase()) ?? [];
    const oldLines = Array.from({ length: a2 - a1 + 1 }, (_, i) => tagsOf(before.infos, a1 + i));
    const newLines = Array.from({ length: b2 - b1 + 1 }, (_, i) => tagsOf(after.infos, b1 + i));
    const oldCounts = countTags(oldLines);
    const newCounts = countTags(newLines);
    for (const tag of hooks.tags.keys()) {
      const diff = (newCounts.get(tag) ?? 0) - (oldCounts.get(tag) ?? 0);
      if (diff === 0) continue;
      const added = diff > 0;
      const idx = added ? newLines.findIndex((l) => l.includes(tag)) : 0;
      const line = b1 + Math.max(0, idx);
      events.push({ tag, line, text: tr.state.doc.line(line).text, added });
    }
  });
  return events;
}
