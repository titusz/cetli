/**
 * Browser platform for development and end-to-end tests: files live in an
 * in-memory map (seeded with a sample document), config in localStorage, and
 * dialogs are simple in-page modals. Tests steer it through `window.cetliWeb`.
 */

import type { FileData, Platform, QuickLogOpen, QuickLogSubmit, SaveChoice, TodoPaperImport } from "./platform";
import { modalChoice } from "../app/modal";

export const SAMPLE_PATH = "/demo/todo.taskpaper";

export const SAMPLE_DOC = `Inbox:
- try Cetli @today
- read the shortcuts list in Help @cetli

Work:
- write the quarterly report @priority(1)
	Include numbers from https://example.com/stats
- call Bob about the launch @today
- fix printer @done(2026-11-10)

Home:
- buy milk @errand
- water the plants
- pay rent @done(2026-11-01)

Archive:
- old task @done(2026-10-01) @archive(Work)
`;

/** Test/dev hooks for steering the web platform. */
export interface WebHooks {
  files: Map<string, string>;
  nextOpenPath: string | null;
  nextSavePath: string | null;
  quickLogHandler: ((p: QuickLogSubmit) => void) | null;
  lastQuickLog: QuickLogOpen | null;
  opened: string[];
  /** Simulate another program changing a file (new content and modification time). */
  touch: (path: string, text: string) => void;
  /** Plugin files (path -> source) returned by listPlugins. */
  plugins: Map<string, string>;
  /** Windows opened with newWindow (URLs). */
  windows: string[];
  /** Test dictionary: misspelled word (lower case) -> suggestions; null uses the browser's own spell checking. */
  dictionary: Record<string, string[]> | null;
}

declare global {
  interface Window {
    cetliWeb?: WebHooks;
  }
}

export function createWebPlatform(): Platform {
  const hooks: WebHooks = {
    files: new Map([[SAMPLE_PATH, SAMPLE_DOC]]),
    nextOpenPath: null,
    nextSavePath: null,
    quickLogHandler: null,
    lastQuickLog: null,
    opened: [],
    touch: (path, text) => {
      hooks.files.set(path, text);
      mtimes.set(path, Date.now() + 1);
    },
    plugins: new Map(),
    windows: [],
    dictionary: null,
  };
  const params = new URLSearchParams(location.search);
  const label = params.get("window") === "doc" ? `doc-${Math.random().toString(36).slice(2, 8)}` : "main";
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cetli") : null;
  const broadcastHandlers = new Map<string, ((p: unknown) => void)[]>();
  if (channel) channel.onmessage = (e) => broadcastHandlers.get(e.data?.event)?.forEach((h) => h(e.data.payload));
  let dropHandler: ((pos: number, paths: string[]) => void) | null = null;
  const mtimes = new Map<string, number>();
  window.cetliWeb = hooks;
  const config = (name: string) => `cetli.${name}`;
  return {
    kind: "web",
    windowLabel: label,
    windowFile: () => params.get("open"),
    primaryLabel: async () => (label === "main" ? "main" : null),
    onPrimaryChanged() {},
    async newWindow(path) {
      const url = `${location.pathname}?window=doc${path ? `&open=${encodeURIComponent(path)}` : ""}`;
      hooks.windows.push(url);
      window.open(url, "_blank");
    },
    broadcast(event, payload) {
      channel?.postMessage({ event, payload });
    },
    onBroadcast(event, handler) {
      broadcastHandlers.set(event, [...(broadcastHandlers.get(event) ?? []), handler as (p: unknown) => void]);
    },
    async setOpacity(alpha) {
      document.documentElement.style.opacity = alpha >= 255 ? "" : String(alpha / 255);
      return true;
    },
    dropFiles(files, pos) {
      dropHandler?.(pos, Array.from(files).map((f) => `/dropped/${f.name}`));
    },
    onFilesDropped(handler) {
      dropHandler = handler;
    },
    async listPlugins() {
      return [...hooks.plugins].map(([path, code]) => ({ path, code }));
    },
    async pluginDir() {
      return null;
    },
    async startPython() {
      throw new Error("Python plugins need the desktop app");
    },
    async spellCheck(texts) {
      const dict = hooks.dictionary;
      if (!dict) return null;
      return texts.map((t) => {
        const ranges: [number, number][] = [];
        for (const m of t.matchAll(/[A-Za-z\u00C0-\u024F']+/g)) if (m[0].toLowerCase() in dict) ranges.push([m.index ?? 0, m[0].length]);
        return ranges;
      });
    },
    async spellSuggest(word) {
      return hooks.dictionary?.[word.toLowerCase()] ?? [];
    },
    async spellAdd(word) {
      if (hooks.dictionary) delete hooks.dictionary[word.toLowerCase()];
    },
    async spellLanguages() {
      return [];
    },
    async configDir() {
      return null;
    },
    async readFile(path) {
      const text = hooks.files.get(path);
      if (text === undefined) throw new Error(`File not found: ${path}`);
      const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
      return { text: text.replace(/\r\n?/g, "\n"), lineEnding, encoding: "utf-8", bom: false, mtime: mtimes.get(path) ?? 1 } satisfies FileData;
    },
    async writeFile(path, text, meta) {
      hooks.files.set(path, meta.lineEnding === "\n" ? text : text.replace(/\n/g, meta.lineEnding));
      const t = Date.now();
      mtimes.set(path, t);
      return t;
    },
    async fileMtime(path) {
      return hooks.files.has(path) ? (mtimes.get(path) ?? 1) : null;
    },
    async deleteFile(path) {
      hooks.files.delete(path);
      mtimes.delete(path);
    },
    async openDialog() {
      const path = hooks.nextOpenPath;
      hooks.nextOpenPath = null;
      return path;
    },
    async saveDialog() {
      const path = hooks.nextSavePath;
      hooks.nextSavePath = null;
      return path;
    },
    async askSave(message) {
      return (await modalChoice(message, [
        { id: "save", label: "Save", primary: true },
        { id: "discard", label: "Don't Save" },
        { id: "cancel", label: "Cancel" },
      ])) as SaveChoice;
    },
    async confirm(message) {
      return (await modalChoice(message, [{ id: "yes", label: "Yes", primary: true }, { id: "no", label: "No" }])) === "yes";
    },
    async alert(message) {
      await modalChoice(message, [{ id: "ok", label: "OK", primary: true }]);
    },
    async loadConfig(name) {
      try {
        return localStorage.getItem(config(name));
      } catch {
        return null;
      }
    },
    async saveConfig(name, contents) {
      try {
        localStorage.setItem(config(name), contents);
      } catch {
        /* storage unavailable */
      }
    },
    setTitle(title) {
      document.title = title;
    },
    async openUrl(url) {
      hooks.opened.push(url);
    },
    async launchFiles() {
      const param = new URLSearchParams(location.search).get("open");
      return param ? [param] : [];
    },
    onOpenFiles() {},
    onCloseRequested() {},
    onTrayEvent() {},
    async setTrayVisible() {},
    async registerGlobalShortcut() {
      return false;
    },
    async unregisterGlobalShortcuts() {},
    async showQuickLog(payload) {
      hooks.lastQuickLog = payload;
      const { openQuickLogOverlay } = await import("../app/quicklog");
      openQuickLogOverlay(payload, (submit) => hooks.quickLogHandler?.(submit));
    },
    onQuickLogSubmit(handler) {
      hooks.quickLogHandler = handler;
    },
    async minimize() {},
    async hide() {},
    async quit() {},
    async todoPaperImport(): Promise<TodoPaperImport> {
      return { settings: null, recentFiles: [], searches: [], zoom: null, opacity: null };
    },
  };
}
