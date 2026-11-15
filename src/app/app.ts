/**
 * The Cetli application controller: owns the editor, the open document and
 * the surrounding UI (menu bar, search bar, outline sidebar, view tabs,
 * status bar), and implements file handling, autosave, external change
 * detection, views, search history and quick logging.
 */

import { ChangeSet, EditorSelection, EditorState, Text, TransactionSpec } from "@codemirror/state";
import { EditorView, ViewUpdate, keymap, runScopeHandlers } from "@codemirror/view";
import { undo, redo, selectAll } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { startCompletion } from "@codemirror/autocomplete";
import { Platform, QuickLogFile, baseName } from "../platform/platform";
import { collectTags, findProjects, listProjects, ancestors } from "../core/outline";
import { findLinks } from "../core/parser";
import { parseQuery, projectToken, splitTokens, toggleSearchToken } from "../core/search";
import { EditorConfig } from "../editor/config";
import { getOutline } from "../editor/model";
import { foldedPositions, getVisibility, isFolded, isLineHidden, refreshFilter, setAllFolds, setFold, setQuery } from "../editor/visibility";
import { CustomStyleRule } from "../editor/highlight";
import { customStyleRules } from "../editor/highlight";
import { compartments, editorExtensions, activeLineExt, spellExt, wrapExt } from "../editor/setup";
import { editorConfig } from "../editor/config";
import * as cmd from "../editor/commands";
import { AppState, DEFAULT_APP_STATE, DEFAULT_SETTINGS, Settings, defaultTagList, importTodoPaperSettings, isDarkTheme, mergeAppState, mergeDefaults, themeCss } from "./settings";
import { LoadedPlugin, PluginHooks, detectTagChanges, loadPlugins } from "./plugins";
import { isPythonPlugin, loadPythonPlugins, startPythonPlugins } from "./python";
import { pageCss } from "./pagesetup";
import { keepSpellingRanges } from "../core/spelling";
import { misspellingAt, setMisspellings, spellingField } from "../editor/spelling";
import { MenuItem, SEPARATOR, acceleratorLabel, closeMenus, keyLabel, renderMenuBar, showMenu } from "./menu";
import { toast } from "./modal";
import { ACTIONS, Action, MENUS } from "./actions";
import { printDocument } from "./print";
import { WELCOME_DOC } from "./welcome";
import { SAMPLE_PATH } from "../platform/web";
import { WriteFormat, backupPath, fileUrl, todoPaperFormat } from "../core/paths";

/** Per-tab view state. */
interface ViewTab {
  query: string;
  folds: number[];
  anchor: number;
  head: number;
  scroll: number;
  history: string[];
  historyPos: number;
}

const HIDE_DONE = "NOT @done";
const IS_WINDOWS = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const HOTKEY_RETRY = 5000;
const MAX_RECENT = 10;
const AUTOSAVE_DELAY = 800;
const WATCH_INTERVAL = 2500;

/** Create an empty view tab. */
function newTab(query = ""): ViewTab {
  return { query, folds: [], anchor: 0, head: 0, scroll: 0, history: [], historyPos: 0 };
}

/** Run a callback, logging (not throwing) errors from plugins. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn("Plugin callback failed", err);
  }
}

/** Get an element by id (throws if missing). */
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

export class App {
  settings: Settings = DEFAULT_SETTINGS;
  state: AppState = DEFAULT_APP_STATE;
  view!: EditorView;
  path: string | null = null;
  meta: WriteFormat = { lineEnding: "\n", encoding: "utf-8", bom: false };
  savedDoc: Text = Text.empty;
  mtime = 0;
  tabs: ViewTab[] = [newTab()];
  activeTab = 0;
  private saving: Promise<boolean> | null = null;
  private saveTimer = 0;
  private backupTimer = 0;
  private spellTimer = 0;
  /** True when the system has no spell checker and the webview's own is used. */
  private nativeSpell = false;
  private hotkeyRetry = 0;
  private watchTimer = 0;
  private outlineTimer = 0;
  private stateTimer = 0;
  private statusMessage = "";
  private searchInput!: HTMLInputElement;
  private styleEl!: HTMLStyleElement;
  /** True for the window owning the global hotkey and the tray icon. */
  primary = true;
  private summaries = new Map<string, QuickLogFile>();
  pluginHooks: PluginHooks = { start: [], tags: new Map() };
  plugins: LoadedPlugin[] = [];
  private menuBar!: { open: (index: number) => void };

  constructor(readonly platform: Platform) {}

  // ------------------------------------------------------------ startup

  /** Load settings, build the UI and open the initial document. */
  async init(): Promise<void> {
    await this.loadConfig();
    this.primary = (await this.platform.primaryLabel()) === this.platform.windowLabel;
    if (this.primary) await this.maybeImportTodoPaper();
    this.buildUi();
    this.applySettings();
    void this.applyOpacity(false);
    const launch = this.primary ? await this.platform.launchFiles() : [];
    const windowFile = this.platform.windowFile();
    const last = this.primary && this.settings.reopenLastFile ? this.state.lastFile : null;
    const initial = windowFile ?? launch[0] ?? last;
    let opened = initial ? await this.openPath(initial, { quiet: !launch[0] && !windowFile }) : false;
    if (!opened && this.platform.kind === "web" && this.primary) opened = await this.openPath(SAMPLE_PATH, { quiet: true });
    if (!opened) this.loadText(this.primary ? WELCOME_DOC : "", null);
    this.platform.onOpenFiles((paths) => paths[0] && void this.openFile(paths[0]));
    this.platform.onCloseRequested(() => this.onCloseRequested());
    this.platform.onQuickLogSubmit((p) => (!p.target || p.target === this.platform.windowLabel) && this.quickLogSubmit(p.text, p.project));
    this.platform.onTrayEvent((e) => (e === "quicklog" ? this.openQuickLog() : void this.quit()));
    this.platform.onFilesDropped((pos, paths) => this.insertFileLinks(pos, paths));
    this.platform.onPrimaryChanged(() => void this.becomePrimary());
    this.listenToOtherWindows();
    window.addEventListener("blur", () => this.flushAutosave());
    this.watchTimer = window.setInterval(() => void this.checkExternalChange(), WATCH_INTERVAL);
    if (this.primary) await this.registerHotkey();
    await this.loadPlugins(true);
    this.view.focus();
  }

  /** Exchange document summaries, settings changes and quit requests with other windows. */
  private listenToOtherWindows(): void {
    const me = this.platform.windowLabel;
    this.platform.onBroadcast<QuickLogFile>("doc-summary", (s) => s.label !== me && this.summaries.set(s.label, s));
    this.platform.onBroadcast<{ label: string }>("doc-closed", (p) => this.summaries.delete(p.label));
    this.platform.onBroadcast("doc-summary-request", () => this.publishSummary());
    this.platform.onBroadcast<{ from: string }>("settings-changed", (p) => p?.from !== me && void this.reloadSettings());
    this.platform.onBroadcast<{ from: string }>("quit-all", (p) => p?.from !== me && void this.quit(false));
    this.platform.broadcast("doc-summary-request", null);
    this.publishSummary();
  }

  /** Take over the duties of the primary window (global hotkey, tray). */
  private async becomePrimary(): Promise<void> {
    this.primary = true;
    this.applySettings();
    await this.registerHotkey();
  }

  /** Re-read settings saved by another window and apply them. */
  private async reloadSettings(): Promise<void> {
    const stored = await this.platform.loadConfig("settings");
    try {
      this.settings = mergeDefaults(DEFAULT_SETTINGS, stored ? JSON.parse(stored) : null);
    } catch {
      return;
    }
    this.applySettings();
    if (this.primary) await this.registerHotkey();
  }

  /** Tell other windows that settings changed. */
  announceSettings(): void {
    this.platform.broadcast("settings-changed", { from: this.platform.windowLabel });
  }

  /** Summary of this window's document for the quick log of any window. */
  private summary(): QuickLogFile {
    const projects = listProjects(getOutline(this.view.state)).map((p) => ({ name: p.name, depth: p.depth }));
    return { label: this.platform.windowLabel, title: this.path ? baseName(this.path) : "Untitled", projects };
  }

  /** Share this window's document summary with the other windows. */
  private publishSummary(): void {
    if (this.view) this.platform.broadcast("doc-summary", this.summary());
  }

  /** Open a new document window. */
  async newWindow(path?: string): Promise<void> {
    await this.platform.newWindow(path);
  }

  // ------------------------------------------------------------ window transparency

  /** Apply the stored window opacity; `report` shows a hint when unsupported. */
  private async applyOpacity(report: boolean): Promise<void> {
    if (this.state.opacity === 255 && !report) return;
    const ok = await this.platform.setOpacity(this.state.opacity);
    if (!ok && report) toast("Window transparency is not supported on this system");
  }

  /** Change window opacity by `delta` (0 resets to opaque), in TodoPaper's steps of 15. */
  changeOpacity(delta: number): void {
    this.state.opacity = delta === 0 ? 255 : Math.max(15, Math.min(255, this.state.opacity + delta));
    void this.applyOpacity(true);
    this.saveState();
  }

  // ------------------------------------------------------------ dropped files

  /** Insert file:/// links for dropped files at a document position. */
  insertFileLinks(pos: number, paths: string[]): void {
    if (!paths.length) {
      toast("Only files from disk can be linked");
      return;
    }
    const at = Math.min(pos, this.view.state.doc.length);
    const insert = paths.map(fileUrl).join(" ");
    this.view.dispatch({ changes: { from: at, insert }, selection: EditorSelection.cursor(at + insert.length), userEvent: "input.drop" });
    this.view.focus();
  }

  // ------------------------------------------------------------ plugins

  /**
   * (Re)load JavaScript and Python plugins from the plugins folder and bind their shortcuts.
   * JavaScript start hooks run when Cetli starts (`atStart`); Python plugins run "on_start"
   * whenever they are loaded, since each load starts a fresh Python process.
   */
  async loadPlugins(atStart = false): Promise<void> {
    this.pluginHooks = { start: [], tags: new Map() };
    const sources = await this.platform.listPlugins();
    this.plugins = await loadPlugins(this, sources.filter((s) => !isPythonPlugin(s.path)), this.pluginHooks);
    this.bindPluginKeys();
    if (atStart) for (const run of this.pluginHooks.start) safely(run);
    const python = await loadPythonPlugins(this, sources.filter((s) => isPythonPlugin(s.path)).map((s) => s.path));
    if (!python.length) return;
    this.plugins = [...this.plugins, ...python];
    this.bindPluginKeys();
    await startPythonPlugins(this);
  }

  /** Bind the shortcuts of actions and plugin menu items. */
  private bindPluginKeys(): void {
    this.view.dispatch({ effects: compartments.appKeys.reconfigure(keymap.of(this.appKeyBindings())) });
  }

  /** Reload plugins and report how many were loaded. */
  async reloadPlugins(): Promise<void> {
    await this.loadPlugins();
    toast(`${this.plugins.filter((p) => !p.error).length} plugin(s) loaded`);
  }

  /** Open the plugins folder in the file manager. */
  async openPluginsFolder(): Promise<void> {
    const dir = await this.platform.pluginDir();
    if (!dir) {
      toast("Plugins are loaded from the plugins folder of the desktop app");
      return;
    }
    await this.platform.openUrl("file:///" + dir.replace(/\\/g, "/"));
  }

  /** Run plugin callbacks for tags added to or removed from lines. */
  private runTagHooks(update: ViewUpdate): void {
    if (!this.pluginHooks.tags.size) return;
    for (const tr of update.transactions) {
      for (const change of detectTagChanges(tr, this.pluginHooks)) {
        for (const fn of this.pluginHooks.tags.get(change.tag) ?? []) safely(() => fn(change));
      }
    }
  }

  /** Read settings and app state from config storage. */
  private async loadConfig(): Promise<void> {
    const parse = (s: string | null) => {
      try {
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    };
    this.settings = mergeDefaults(DEFAULT_SETTINGS, parse(await this.platform.loadConfig("settings")));
    this.state = mergeDefaults(DEFAULT_APP_STATE, parse(await this.platform.loadConfig("state")));
  }

  /** On first start, import preferences, recent files and searches from TodoPaper. */
  private async maybeImportTodoPaper(): Promise<void> {
    if (this.state.imported) return;
    this.state.imported = true;
    const found = await this.platform.todoPaperImport();
    if (found.settings) this.settings = importTodoPaperSettings(found.settings, this.settings);
    if (found.recentFiles.length) {
      this.state.recentFiles = found.recentFiles.slice(0, MAX_RECENT);
      this.state.lastFile = found.recentFiles[0];
    }
    if (found.searches.length) this.state.savedSearches = found.searches.slice(0, MAX_RECENT);
    if (found.zoom !== null && found.zoom !== undefined) this.state.zoom = found.zoom;
    if (found.opacity !== null && found.opacity !== undefined) this.state.opacity = found.opacity;
    await this.saveSettings();
    this.saveState(true);
    if (found.settings || found.recentFiles.length) setTimeout(() => toast("Imported your TodoPaper preferences and recent files"), 600);
  }

  async saveSettings(): Promise<void> {
    await this.platform.saveConfig("settings", JSON.stringify(this.settings, null, 2));
  }

  /** Persist app state (debounced unless `now`). */
  saveState(now = false, replaceRecent = false): void {
    window.clearTimeout(this.stateTimer);
    const write = async () => {
      // other windows write the same file: merge their recent files and views
      let stored: unknown = null;
      try {
        stored = JSON.parse((await this.platform.loadConfig("state")) ?? "null");
      } catch {
        stored = null;
      }
      const merged = mergeAppState(mergeDefaults(DEFAULT_APP_STATE, stored), this.state, replaceRecent);
      await this.platform.saveConfig("state", JSON.stringify(merged, null, 2));
    };
    if (now) void write();
    else this.stateTimer = window.setTimeout(() => void write(), 500);
  }

  // ------------------------------------------------------------ UI construction

  private buildUi(): void {
    this.styleEl = document.createElement("style");
    this.styleEl.id = "theme-style";
    document.head.appendChild(this.styleEl);
    this.menuBar = renderMenuBar($("menubar"), MENUS.map((m) => ({ label: m.label, items: () => m.items(this) })));
    this.buildSearchBar();
    this.buildSidebar();
    this.view = new EditorView({ state: this.createState(""), parent: $("editor") });
    this.view.dom.addEventListener("keydown", (e) => e.key === "Control" || e.key === "Meta" ? this.view.dom.classList.add("mod-down") : undefined);
    window.addEventListener("keyup", (e) => (e.key === "Control" || e.key === "Meta") && this.view.dom.classList.remove("mod-down"));
    window.addEventListener("blur", () => this.view.dom.classList.remove("mod-down"));
    window.addEventListener("keydown", (e) => this.onGlobalKey(e));
    this.watchLoneAlt();
    this.view.scrollDOM.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  /** Effective editor config from settings. */
  private editorConfig(): Partial<EditorConfig> {
    const s = this.settings;
    return { dateFormat: s.dateFormat, autoTagDoneDate: s.autoTagDoneDate, autoIndent: s.autoIndent, inbox: s.inbox, defaultTags: defaultTagList(s) };
  }

  /** Custom style rules for the highlighter. */
  private customRules(): CustomStyleRule[] {
    return this.settings.customStyles.flatMap((c, i) => (c.enabled && c.match ? [{ className: `cm-tp-custom-${i}`, match: c.match, wholeLine: c.wholeLine }] : []));
  }

  /** Create a fresh editor state for a document. */
  private createState(doc: string): EditorState {
    const s = this.settings;
    const ext = editorExtensions(
      {
        onTagClick: (tag) => this.toggleSearchToken(tag),
        onProjectClick: (name) => this.toggleSearchToken(projectToken(name)),
        onLinkClick: (url) => void this.platform.openUrl(url),
        onContextMenu: (event, pos) => void this.showContextMenu(event, pos),
        onEscape: () => this.onEscape(),
        onDropFiles: (files, pos) => this.platform.dropFiles(files, pos),
        onUpdate: (u) => this.onEditorUpdate(u),
      },
      {
        config: this.editorConfig(),
        wordWrap: s.wordWrap,
        activeLine: s.theme.activeLine,
        spellCheck: s.spellCheck,
        customStyles: this.customRules(),
      },
    );
    const state = EditorState.create({ doc, extensions: ext });
    return state.update({ effects: compartments.appKeys.reconfigure(keymap.of(this.appKeyBindings())) }).state;
  }

  /** Key bindings for all actions that have a shortcut (usable from anywhere). */
  private appKeyBindings() {
    const bindings = [];
    for (const action of ACTIONS) {
      for (const key of action.keys ?? []) {
        bindings.push({ key, scope: "editor global", preventDefault: true, run: () => (this.runAction(action), true) });
      }
    }
    for (const plugin of this.plugins) {
      for (const item of plugin.items) {
        if (item.key) bindings.push({ key: item.key, scope: "editor global", preventDefault: true, run: () => (safely(item.run), true) });
      }
    }
    return bindings;
  }

  /** Run an action by object or id. */
  runAction(action: Action | string): void {
    const a = typeof action === "string" ? ACTIONS.find((x) => x.id === action) : action;
    if (!a || (a.enabled && !a.enabled(this))) return;
    void a.run(this);
  }

  /** Open the menu bar when Alt is pressed and released on its own (or F10), like native Windows menus. */
  private watchLoneAlt(): void {
    let altDown = 0;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Alt" && !e.repeat) altDown = Date.now();
        else altDown = 0;
        if (e.key === "F10" && !e.shiftKey && !document.querySelector(".modal-backdrop")) {
          e.preventDefault();
          this.openMenu(0);
        }
      },
      true,
    );
    window.addEventListener(
      "keyup",
      (e) => {
        if (e.key === "Alt" && altDown && Date.now() - altDown < 700 && !document.querySelector(".modal-backdrop, .menu")) {
          e.preventDefault();
          this.openMenu(0);
        }
        if (e.key === "Alt") altDown = 0;
      },
      true,
    );
    window.addEventListener("mousedown", () => (altDown = 0), true);
  }

  /** Run global shortcuts for keys pressed outside the editor; block webview browser shortcuts everywhere. */
  private onGlobalKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || document.querySelector(".modal-backdrop")) return;
    const target = e.target as HTMLElement;
    const inEditor = !!target.closest?.(".cm-editor");
    if (!inEditor && runScopeHandlers(this.view, e, "global")) {
      e.preventDefault();
      return;
    }
    // reload, print, find, history, downloads, view source, caret browsing, ...
    if ((e.ctrlKey || e.metaKey) && /^[bdefghijlmnopqrstuw]$/i.test(e.key)) e.preventDefault();
    if (["F3", "F5", "F7", "BrowserBack", "BrowserForward"].includes(e.key)) e.preventDefault();
  }

  private buildSearchBar(): void {
    this.searchInput = $("search") as HTMLInputElement;
    const input = this.searchInput;
    input.addEventListener("input", () => this.setSearch(input.value, { fromInput: true }));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.resetSearch();
        this.view.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.commitSearch(true);
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        this.commitSearch(false);
        this.view.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.showSearchMenu();
      }
    });
    input.addEventListener("blur", () => this.commitSearch(false));
    $("search-clear").addEventListener("click", () => {
      this.resetSearch();
      this.view.focus();
    });
    $("search-menu").addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.showSearchMenu();
    });
    $("search-refresh").addEventListener("click", () => this.refreshSearch());
  }

  private buildSidebar(): void {
    const mode = $("outline-mode") as HTMLSelectElement;
    mode.value = this.state.outlineMode;
    mode.addEventListener("change", () => {
      this.state.outlineMode = mode.value === "tags" ? "tags" : "projects";
      this.saveState();
      this.renderOutline();
    });
    const list = $("outline-list");
    list.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (!li) return;
      if (li.dataset.line) this.revealLine(Number(li.dataset.line));
      else if (li.dataset.tag) this.toggleSearchToken(li.dataset.tag);
    });
    list.addEventListener("dblclick", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (li?.dataset.project) this.toggleSearchToken(projectToken(li.dataset.project));
    });
    const splitter = $("splitter");
    splitter.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const sidebar = $("sidebar");
      const startX = e.clientX;
      const startW = sidebar.offsetWidth;
      const move = (ev: MouseEvent) => {
        const w = Math.max(120, Math.min(window.innerWidth - 200, startW + ev.clientX - startX));
        sidebar.style.width = `${w}px`;
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        this.state.outlineWidth = sidebar.offsetWidth;
        this.saveState();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  // ------------------------------------------------------------ settings

  /** Apply settings to the editor and UI. */
  applySettings(): void {
    const s = this.settings;
    this.styleEl.textContent = themeCss(s.theme, this.state.zoom, s.customStyles);
    document.body.classList.toggle("dark", isDarkTheme(s.theme));
    this.view.dispatch({
      effects: [
        compartments.config.reconfigure(editorConfig.of(this.editorConfig())),
        compartments.wrap.reconfigure(wrapExt(s.wordWrap)),
        compartments.activeLine.reconfigure(activeLineExt(s.theme.activeLine)),
        compartments.spell.reconfigure(spellExt(s.spellCheck && this.nativeSpell)),
        compartments.custom.reconfigure(customStyleRules.of(this.customRules())),
      ],
    });
    $("sidebar").style.width = `${this.state.outlineWidth}px`;
    this.startBackupTimer();
    this.scheduleSpellCheck();
    this.showOutline(s.showOutline);
    if (this.primary) void this.platform.setTrayVisible(s.alwaysShowInTray || s.minimizeToTray);
  }

  /** Change font zoom by `delta` points (0 resets). */
  zoom(delta: number): void {
    this.state.zoom = delta === 0 ? 0 : Math.max(-6, Math.min(24, this.state.zoom + delta));
    this.styleEl.textContent = themeCss(this.settings.theme, this.state.zoom, this.settings.customStyles);
    this.view.requestMeasure();
    this.saveState();
  }

  /**
   * Register the global Quick Log hotkey. While another program holds it (such
   * as a TodoPaper that is still running) Cetli keeps trying and takes the
   * hotkey over as soon as it becomes free.
   */
  async registerHotkey(): Promise<void> {
    window.clearTimeout(this.hotkeyRetry);
    await this.platform.unregisterGlobalShortcuts();
    const shortcut = this.settings.quickLogShortcut;
    if (!this.settings.quickLog || !shortcut) return;
    const attempt = () => this.platform.registerGlobalShortcut(shortcut, () => this.openQuickLog());
    if ((await attempt()) || this.platform.kind !== "tauri") return;
    const label = acceleratorLabel(shortcut);
    const hint = shortcut.includes("IntlBackslash") ? " (is TodoPaper still running?)" : "";
    toast(`Quick Log hotkey ${label} is used by another program${hint}. Cetli takes it over when it is free.`, 7000);
    const retry = async () => {
      if (!this.primary || this.settings.quickLogShortcut !== shortcut || !this.settings.quickLog) return;
      if (await attempt()) toast(`Quick Log hotkey ${label} is now active`);
      else this.hotkeyRetry = window.setTimeout(() => void retry(), HOTKEY_RETRY);
    };
    this.hotkeyRetry = window.setTimeout(() => void retry(), HOTKEY_RETRY);
  }

  // ------------------------------------------------------------ editor updates

  private onEditorUpdate(u: ViewUpdate): void {
    if (u.docChanged) this.runTagHooks(u);
    if ((u.docChanged || u.viewportChanged) && this.settings.spellCheck) this.scheduleSpellCheck();
    if (u.docChanged) {
      this.mapInactiveTabs(u.changes);
      this.scheduleAutosave();
      this.scheduleOutline();
    }
    if (u.docChanged || u.transactions.some((t) => t.effects.length)) {
      this.updateTitle();
      $("search-refresh").hidden = !getVisibility(u.state).stale;
      this.updateEmptyState();
    }
  }

  /** Keep stored positions of inactive tabs in sync with document edits. */
  private mapInactiveTabs(changes: ChangeSet): void {
    this.tabs.forEach((t, i) => {
      if (i === this.activeTab) return;
      t.folds = t.folds.map((p) => changes.mapPos(p, 1));
      t.anchor = changes.mapPos(t.anchor);
      t.head = changes.mapPos(t.head);
    });
  }

  /** Show a hint when the search hides every line. */
  private updateEmptyState(): void {
    const vis = getVisibility(this.view.state);
    const empty = vis.query.trim() !== "" && vis.hidden.every((h) => h === 1);
    $("empty-state").hidden = !empty;
  }

  /** Dispatch a command transaction (ignores null). */
  dispatch(spec: TransactionSpec | null): boolean {
    if (!spec) return false;
    this.view.dispatch(spec);
    return true;
  }

  /** Run a state command against the editor and refocus it. */
  run(fn: (state: EditorState) => TransactionSpec | null): void {
    this.dispatch(fn(this.view.state));
    this.view.focus();
  }

  /** Selected visible line numbers. */
  selectedLines(): number[] {
    return cmd.selectedLines(this.view.state);
  }

  // ------------------------------------------------------------ files

  get dirty(): boolean {
    return !this.view.state.doc.eq(this.savedDoc);
  }

  /** Replace the editor content with a new document. */
  private loadText(text: string, path: string | null): void {
    this.persistViews();
    this.path = path;
    this.view.setState(this.createState(text));
    this.savedDoc = this.view.state.doc;
    this.tabs = [newTab()];
    this.activeTab = 0;
    this.restoreViews();
    this.renderTabs();
    this.searchInput.value = this.tabs[this.activeTab].query;
    this.updateTitle();
    this.renderOutline();
    this.updateEmptyState();
  }

  /** Open a path, reporting errors unless `quiet`. Returns true on success. */
  async openPath(path: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
    try {
      const data = await this.platform.readFile(path);
      this.loadText(data.text, path);
      this.meta = todoPaperFormat(path, data, IS_WINDOWS);
      this.mtime = data.mtime;
      this.addRecent(path);
      await this.offerBackupRestore(path);
      return true;
    } catch (err) {
      if (!opts.quiet) await this.platform.alert(`Could not open ${path}\n\n${String(err)}`);
      return false;
    }
  }

  /** If an autosave backup of the file exists (e.g. after a crash), offer to restore it. */
  private async offerBackupRestore(path: string): Promise<void> {
    const backup = backupPath(path);
    if ((await this.platform.fileMtime(backup)) === null) return;
    const restore = await this.platform.confirm("An autosave (backup) file for this document exists. Would you like to restore from it instead?", "Backup File Found");
    if (!restore) return;
    const data = await this.platform.readFile(backup);
    const saved = this.savedDoc;
    this.replaceDoc(data.text);
    this.savedDoc = saved; // the restored text counts as unsaved changes
    this.updateTitle();
  }

  /** Write the autosave backup copy ("name (autosave).ext") if there are unsaved changes. */
  private async writeBackup(): Promise<void> {
    if (!this.path || !this.dirty || this.saving) return;
    try {
      await this.platform.writeFile(backupPath(this.path), this.view.state.doc.toString(), this.meta);
      this.setStatus("Backup saved");
    } catch (err) {
      this.setStatus("Autosave error");
      console.warn("autosave backup failed", err);
    }
  }

  /** Delete the autosave backup of the current file, if any. */
  private async removeBackup(): Promise<void> {
    if (!this.path) return;
    const backup = backupPath(this.path);
    if ((await this.platform.fileMtime(backup)) !== null) await this.platform.deleteFile(backup).catch(() => undefined);
  }

  /** (Re)start the periodic backup timer according to the autosave settings. */
  private startBackupTimer(): void {
    window.clearInterval(this.backupTimer);
    const s = this.settings;
    if (s.autoSave && s.autoSaveMode === "backup") {
      this.backupTimer = window.setInterval(() => void this.writeBackup(), Math.max(1, s.autoSaveInterval) * 1000);
    }
  }

  /** True when edits are written to the file automatically. */
  private get savesFileAutomatically(): boolean {
    return this.settings.autoSave && this.settings.autoSaveMode === "file" && this.path !== null;
  }

  /** Open a file (asking for a path when none is given). */
  async openFile(path?: string): Promise<void> {
    const target = path ?? (await this.platform.openDialog());
    if (!target || !(await this.confirmClose())) return;
    if (await this.openPath(target)) this.view.focus();
  }

  /** Start a new, untitled document. */
  async newFile(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.loadText("", null);
    this.meta = todoPaperFormat("", { lineEnding: "\n", encoding: "utf-8", bom: false }, IS_WINDOWS);
    this.view.focus();
  }

  /** Close the current file (leaves an empty untitled document). */
  async closeFile(): Promise<void> {
    await this.newFile();
  }

  /** Save to the current path (or ask for one). */
  async save(): Promise<boolean> {
    if (!this.path) return this.saveAs();
    if (this.saving) await this.saving;
    this.saving = this.writeDoc(this.path);
    try {
      return await this.saving;
    } finally {
      this.saving = null;
    }
  }

  /** Save under a new path. */
  async saveAs(): Promise<boolean> {
    const suggested = this.path ?? "todo.taskpaper";
    const target = await this.platform.saveDialog(suggested);
    if (!target) return false;
    this.persistViews();
    this.path = target;
    this.meta = todoPaperFormat(target, this.meta, IS_WINDOWS);
    const ok = await this.writeDoc(target);
    if (ok) this.addRecent(target);
    return ok;
  }

  /** Write the document to disk. */
  private async writeDoc(path: string): Promise<boolean> {
    window.clearTimeout(this.saveTimer);
    const doc = this.view.state.doc;
    try {
      this.setStatus("Saving…");
      this.mtime = await this.platform.writeFile(path, doc.toString(), this.meta);
      if (path === this.path) this.savedDoc = doc;
      this.setStatus("Saved");
      this.updateTitle();
      return true;
    } catch (err) {
      this.setStatus("Save failed");
      await this.platform.alert(`Could not save ${path}\n\n${String(err)}`);
      return false;
    }
  }

  /** Schedule an automatic save after edits (when autosave writes the file itself). */
  private scheduleAutosave(): void {
    if (!this.savesFileAutomatically) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushAutosave(), AUTOSAVE_DELAY);
  }

  /** Save now if autosave writes the file itself and there are unsaved changes. */
  async flushAutosave(): Promise<void> {
    if (this.savesFileAutomatically && this.dirty) await this.save();
  }

  /** Reload the file from disk. */
  async reload(ask = true): Promise<void> {
    if (!this.path) return;
    if (ask && this.dirty && !(await this.platform.confirm("Reload the file from disk and lose your unsaved changes?"))) return;
    const data = await this.platform.readFile(this.path);
    this.replaceDoc(data.text);
    this.meta = todoPaperFormat(this.path, data, IS_WINDOWS);
    this.mtime = data.mtime;
  }

  /** Replace the document text in place, keeping cursor line, view state and undo history. */
  private replaceDoc(text: string): void {
    const state = this.view.state;
    const line = state.doc.lineAt(state.selection.main.head).number;
    const scroll = this.view.scrollDOM.scrollTop;
    const next = Text.of(text.split("\n"));
    const pos = next.line(Math.min(line, next.lines)).from;
    this.view.dispatch({ changes: { from: 0, to: state.doc.length, insert: next }, selection: EditorSelection.cursor(pos), effects: refreshFilter.of(null) });
    this.savedDoc = this.view.state.doc;
    this.view.scrollDOM.scrollTop = scroll;
    this.updateTitle();
  }

  /** Detect changes made to the file by other programs (or sync clients). */
  private async checkExternalChange(): Promise<void> {
    if (!this.path || this.saving || document.querySelector(".modal-backdrop")) return;
    const path = this.path;
    const mtime = await this.platform.fileMtime(path);
    if (mtime === null || mtime === this.mtime || path !== this.path) return;
    const silent = this.settings.reloadSilently && !this.dirty;
    // like TodoPaper, ask only while the window is active; the change is picked up on the next check
    if (!silent && !document.hasFocus()) return;
    const data = await this.platform.readFile(path);
    this.mtime = data.mtime;
    if (data.text === this.savedDoc.toString()) return;
    if (silent) {
      this.replaceDoc(data.text);
      toast("Reloaded: the file changed on disk");
      return;
    }
    if (await this.platform.confirm(`Your file (${path}) has changed on disk, would you like to reload the changes?`, "File Changed")) {
      this.replaceDoc(data.text);
    }
  }

  /** Make sure unsaved changes are handled (and the backup copy removed). Returns false to abort. */
  async confirmClose(): Promise<boolean> {
    window.clearTimeout(this.saveTimer);
    const ok = await this.resolveUnsaved();
    if (ok) await this.removeBackup();
    return ok;
  }

  /** Save, discard or cancel unsaved changes. */
  private async resolveUnsaved(): Promise<boolean> {
    if (!this.dirty) return true;
    if (this.savesFileAutomatically) return this.save();
    if (!this.path && this.view.state.doc.toString() === WELCOME_DOC) return true;
    const choice = await this.platform.askSave(`Save changes to ${this.path ? baseName(this.path) : "Untitled"}?`);
    if (choice === "cancel") return false;
    if (choice === "save") return this.save();
    return true;
  }

  /** Hide the window to the system tray. */
  private async hideToTray(): Promise<void> {
    await this.platform.setTrayVisible(true);
    await this.platform.hide();
  }

  /** Window close requested. Returns true to allow closing. */
  private async onCloseRequested(): Promise<boolean> {
    if (this.settings.minimizeToTray) {
      await this.hideToTray();
      return false;
    }
    if (!(await this.confirmClose())) return false;
    this.persistViews();
    this.saveState(true);
    this.platform.broadcast("doc-closed", { label: this.platform.windowLabel });
    return true;
  }

  /** Quit: close this window (and, with `all`, every other document window). */
  async quit(all = true): Promise<void> {
    if (all) this.platform.broadcast("quit-all", { from: this.platform.windowLabel });
    if (!(await this.confirmClose())) return;
    this.platform.broadcast("doc-closed", { label: this.platform.windowLabel });
    this.persistViews();
    this.saveState(true);
    window.clearInterval(this.watchTimer);
    await this.platform.quit();
  }

  /** Remember a file in the recent list. */
  private addRecent(path: string): void {
    this.state.recentFiles = [path, ...this.state.recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT);
    this.state.lastFile = path;
    this.saveState();
  }

  clearRecent(): void {
    this.state.recentFiles = this.path ? [this.path] : [];
    this.saveState(true, true);
  }

  // ------------------------------------------------------------ title and status

  updateTitle(): void {
    const name = this.path ? baseName(this.path) : "Untitled";
    const dirty = this.dirty;
    this.platform.setTitle(`${name}${dirty ? "*" : ""} - Cetli`);
    $("status-file").textContent = this.path ?? "Untitled";
    $("status-file").title = this.path ?? "";
    if (dirty && this.statusMessage === "Saved") this.statusMessage = "";
    $("status-save").textContent = dirty ? (this.savesFileAutomatically ? "Editing…" : "Unsaved changes") : this.statusMessage || (this.path ? "Saved" : "");
  }

  private setStatus(message: string): void {
    this.statusMessage = message;
    $("status-save").textContent = message;
  }

  /** Recount tasks for the status bar. */
  private updateCounts(): void {
    let open = 0;
    let done = 0;
    for (const info of getOutline(this.view.state).infos) {
      if (info.type !== "task" || info.tags.some((t) => t.name === "archive")) continue;
      if (info.done) done++;
      else open++;
    }
    $("status-info").textContent = `${open} open · ${done} done`;
  }

  // ------------------------------------------------------------ search

  /** Set the active view's search query. */
  setSearch(text: string, opts: { fromInput?: boolean; commit?: boolean } = {}): void {
    const tab = this.tabs[this.activeTab];
    tab.query = text;
    if (!opts.fromInput) this.searchInput.value = text;
    this.view.dispatch({ effects: setQuery.of(text) });
    this.fixHiddenSelection();
    if (opts.commit) this.commitSearch(false);
    this.renderTabs();
    this.renderOutlineMarks();
  }

  /** Move the cursor out of hidden lines after the filter changed. */
  private fixHiddenSelection(): void {
    const state = this.view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    if (!isLineHidden(state, line.number)) {
      this.view.dispatch({ effects: EditorView.scrollIntoView(state.selection.main.head, { y: "center" }) });
      return;
    }
    const hidden = getVisibility(state).hidden;
    const first = hidden.findIndex((h) => h === 0);
    if (first < 0) return;
    const pos = state.doc.line(first + 1).from;
    this.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "start" }) });
  }

  /** Record the current query in the view's history (and saved searches with `save`). */
  commitSearch(save: boolean): void {
    const tab = this.tabs[this.activeTab];
    const q = tab.query.trim();
    if (q && tab.history[tab.historyPos] !== q) {
      tab.history = [q, ...tab.history.slice(tab.historyPos)].slice(0, 20);
      tab.historyPos = 0;
    }
    if (save && q) {
      this.state.savedSearches = [q, ...this.state.savedSearches.filter((s) => s !== q)].slice(0, MAX_RECENT);
      this.saveState();
    }
  }

  resetSearch(): void {
    this.commitSearch(false);
    this.setSearch("");
  }

  focusSearch(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  refreshSearch(): void {
    this.view.dispatch({ effects: refreshFilter.of(null) });
    this.view.focus();
  }

  /** Toggle a tag or <project> token in the search. */
  toggleSearchToken(token: string): void {
    this.setSearch(toggleSearchToken(this.tabs[this.activeTab].query, token), { commit: true });
  }

  /** Toggle "NOT @done" in the search (Hide Done Tasks). */
  toggleHideDone(): void {
    const q = this.tabs[this.activeTab].query;
    const next = q.includes(HIDE_DONE) ? q.replace(HIDE_DONE, "").replace(/\s+/g, " ").trim() : `${q} ${HIDE_DONE}`.trim();
    this.setSearch(next, { commit: true });
  }

  get hidingDone(): boolean {
    return this.tabs[this.activeTab].query.includes(HIDE_DONE);
  }

  /** Move through the active view's search history. */
  searchHistory(dir: -1 | 1): void {
    const tab = this.tabs[this.activeTab];
    const pos = tab.historyPos - dir;
    if (pos < 0 || pos >= tab.history.length) return;
    tab.historyPos = pos;
    this.setSearch(tab.history[pos]);
  }

  canSearchHistory(dir: -1 | 1): boolean {
    const tab = this.tabs[this.activeTab];
    const pos = tab.historyPos - dir;
    return pos >= 0 && pos < tab.history.length;
  }

  /** Show the saved searches / history dropdown below the search box. */
  showSearchMenu(): void {
    const tab = this.tabs[this.activeTab];
    const items: MenuItem[] = [];
    const pick = (q: string) => () => {
      this.setSearch(q, { commit: true });
      this.view.focus();
    };
    items.push({ label: "Saved Searches", header: true });
    if (this.state.savedSearches.length) this.state.savedSearches.forEach((q) => items.push({ label: q, action: pick(q) }));
    else items.push({ label: "No saved searches — press Enter in the search box to save one", enabled: false });
    if (tab.history.length) {
      items.push(SEPARATOR, { label: "Search History", header: true });
      tab.history.slice(0, 10).forEach((q) => items.push({ label: q, action: pick(q) }));
    }
    items.push(SEPARATOR, { label: "Hide Done Tasks", checked: this.hidingDone, action: () => this.toggleHideDone() });
    if (this.state.savedSearches.length) {
      items.push({
        label: "Clear Saved Searches",
        action: () => {
          this.state.savedSearches = [];
          this.saveState();
        },
      });
    }
    const r = $("search-box").getBoundingClientRect();
    showMenu(items, r.left, r.bottom + 2, { selectFirst: true });
  }

  // ------------------------------------------------------------ views (tabs)

  /** Save the editor's current view state into the active tab. */
  private captureTab(): void {
    const tab = this.tabs[this.activeTab];
    const state = this.view.state;
    tab.folds = foldedPositions(state);
    tab.anchor = state.selection.main.anchor;
    tab.head = state.selection.main.head;
    tab.scroll = this.view.scrollDOM.scrollTop;
  }

  /** Load a tab's view state into the editor. */
  private applyTab(index: number): void {
    this.activeTab = index;
    const tab = this.tabs[index];
    const len = this.view.state.doc.length;
    this.view.dispatch({
      effects: [setQuery.of(tab.query), setAllFolds.of(tab.folds.filter((p) => p <= len))],
      selection: EditorSelection.single(Math.min(tab.anchor, len), Math.min(tab.head, len)),
    });
    this.searchInput.value = tab.query;
    this.view.scrollDOM.scrollTop = tab.scroll;
    this.renderTabs();
    this.renderOutlineMarks();
  }

  switchView(index: number): void {
    if (index === this.activeTab || index < 0 || index >= this.tabs.length) return;
    this.captureTab();
    this.applyTab(index);
    this.view.focus();
  }

  nextView(dir: -1 | 1): void {
    if (this.tabs.length < 2) return;
    this.switchView((this.activeTab + dir + this.tabs.length) % this.tabs.length);
  }

  newView(): void {
    this.captureTab();
    const tab = newTab();
    tab.folds = [...this.tabs[this.activeTab].folds];
    this.tabs.push(tab);
    this.applyTab(this.tabs.length - 1);
    this.focusSearch();
  }

  closeView(index = this.activeTab): void {
    if (index === 0 || index >= this.tabs.length) return;
    if (index === this.activeTab) {
      this.tabs.splice(index, 1);
      this.applyTab(Math.min(index, this.tabs.length - 1));
    } else {
      this.tabs.splice(index, 1);
      if (index < this.activeTab) this.activeTab--;
      this.renderTabs();
    }
    this.view.focus();
  }

  /** Close the active view, or the file when on the master view. */
  async closeViewOrFile(): Promise<void> {
    if (this.activeTab > 0) this.closeView();
    else await this.closeFile();
  }

  private renderTabs(): void {
    const bar = $("tabs");
    bar.hidden = this.tabs.length < 2;
    bar.innerHTML = "";
    this.tabs.forEach((tab, i) => {
      const el = document.createElement("div");
      el.className = "tab" + (i === this.activeTab ? " active" : "");
      el.title = tab.query || "All lines";
      const label = document.createElement("span");
      label.textContent = i === 0 ? (tab.query ? `Master: ${tab.query}` : "Master View") : tab.query || `View ${i}`;
      el.appendChild(label);
      if (i > 0) {
        const close = document.createElement("span");
        close.className = "tab-close";
        close.textContent = "×";
        close.title = "Close view";
        close.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.closeView(i);
        };
        el.appendChild(close);
      }
      el.onmousedown = (e) => {
        if (e.button === 1 && i > 0) this.closeView(i);
        else if (e.button === 0) this.switchView(i);
      };
      bar.appendChild(el);
    });
  }

  /** Store the open file's views (queries and folded project names). */
  private persistViews(): void {
    if (!this.path || !this.view) return;
    this.captureTab();
    const outline = getOutline(this.view.state);
    const doc = this.view.state.doc;
    const folded = (positions: number[]) =>
      positions.map((p) => outline.infos[doc.lineAt(Math.min(p, doc.length)).number - 1]).filter((i) => i?.type === "project").map((i) => i.name);
    this.state.views[this.path] = {
      queries: this.tabs.map((t) => t.query),
      active: this.activeTab,
      folded: folded(this.tabs[0].folds),
    };
    this.saveState();
  }

  /** Restore views saved for the current file. */
  private restoreViews(): void {
    const saved = this.path ? this.state.views[this.path] : undefined;
    if (!saved) return;
    const outline = getOutline(this.view.state);
    const folds = saved.folded.flatMap((name) => findProjects(outline, name)).map((i) => this.view.state.doc.line(i + 1).from);
    this.tabs = saved.queries.map((q) => ({ ...newTab(q), folds: [...folds] }));
    if (!this.tabs.length) this.tabs = [newTab()];
    const active = Math.min(saved.active, this.tabs.length - 1);
    this.activeTab = -1;
    this.applyTab(Math.max(0, active));
  }

  // ------------------------------------------------------------ outline sidebar

  get outlineVisible(): boolean {
    return !$("sidebar").hidden;
  }

  showOutline(show: boolean): void {
    $("sidebar").hidden = !show;
    $("splitter").hidden = !show;
    if (show) this.renderOutline();
  }

  toggleOutline(): void {
    this.settings.showOutline = !this.outlineVisible;
    this.showOutline(this.settings.showOutline);
    void this.saveSettings();
  }

  private scheduleOutline(): void {
    window.clearTimeout(this.outlineTimer);
    this.outlineTimer = window.setTimeout(() => this.renderOutline(), 250);
  }

  /** Render the projects or tags list and the status counts. */
  renderOutline(): void {
    this.updateCounts();
    this.publishSummary();
    if (!this.outlineVisible) return;
    const list = $("outline-list");
    const outline = getOutline(this.view.state);
    list.innerHTML = "";
    if (this.state.outlineMode === "projects") {
      for (const p of listProjects(outline)) {
        const li = document.createElement("li");
        li.textContent = p.name;
        li.style.paddingLeft = `${10 + p.depth * 14}px`;
        li.dataset.line = String(p.line + 1);
        li.dataset.project = p.name;
        li.title = "Click: jump · Double-click: show only this project";
        list.appendChild(li);
      }
    } else {
      for (const tag of collectTags(outline.infos, defaultTagList(this.settings))) {
        const li = document.createElement("li");
        li.textContent = tag;
        li.dataset.tag = tag;
        li.title = "Click: filter by this tag";
        list.appendChild(li);
      }
    }
    this.renderOutlineMarks();
  }

  /** Bold the outline entries that are part of the current search. */
  private renderOutlineMarks(): void {
    if (!this.outlineVisible) return;
    const q = parseQuery(this.tabs[this.activeTab].query);
    const projects = new Set(q.projects.map((p) => p.toLowerCase()));
    const tokens = new Set(splitTokens(this.tabs[this.activeTab].query).map((t) => t.toLowerCase()));
    for (const li of Array.from($("outline-list").children) as HTMLElement[]) {
      const on = li.dataset.project ? projects.has(li.dataset.project.toLowerCase()) : tokens.has((li.dataset.tag ?? "").toLowerCase());
      li.classList.toggle("active", on);
    }
  }

  /** Scroll to a line (1-based), unfolding its projects when needed. */
  revealLine(lineNumber: number): void {
    let state = this.view.state;
    if (lineNumber > state.doc.lines) return;
    const outline = getOutline(state);
    const unfold = ancestors(outline, lineNumber - 1).filter((p) => isFolded(state, p)).map((p) => setFold.of({ pos: state.doc.line(p + 1).from, folded: false }));
    if (unfold.length) this.view.dispatch({ effects: unfold });
    state = this.view.state;
    if (isLineHidden(state, lineNumber)) {
      toast("That project is hidden by the current search");
      return;
    }
    const pos = state.doc.line(lineNumber).from;
    this.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 20 }) });
    this.view.focus();
  }

  // ------------------------------------------------------------ editing actions

  foldAll(fold: boolean): void {
    this.view.dispatch({ effects: setAllFolds.of(fold ? cmd.foldableProjects(this.view.state) : []) });
    if (fold) this.fixHiddenSelection();
    this.view.focus();
  }

  undo(): void {
    undo(this.view);
    this.view.focus();
  }

  redo(): void {
    redo(this.view);
    this.view.focus();
  }

  selectAll(): void {
    selectAll(this.view);
    this.view.focus();
  }

  openFind(): void {
    openSearchPanel(this.view);
  }

  newTag(): void {
    this.run(cmd.newTag);
    startCompletion(this.view);
  }

  /** Copy the selection (or nothing) to the clipboard. */
  async copy(cut = false): Promise<void> {
    const state = this.view.state;
    const text = state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join("\n");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    if (cut) this.view.dispatch(state.replaceSelection(""));
    this.view.focus();
  }

  async paste(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      this.view.dispatch(this.view.state.replaceSelection(text));
    } catch {
      toast(`Use ${keyLabel("Mod-v")} to paste`);
    }
    this.view.focus();
  }

  /** Cut the text of the current line (the empty line stays, as in TodoPaper). */
  async cutLine(): Promise<void> {
    const range = cmd.lineTextRange(this.view.state);
    const text = this.view.state.sliceDoc(range.from, range.to);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable: still cut */
    }
    this.view.dispatch({ changes: { from: range.from, to: range.to }, userEvent: "delete.cut" });
    this.view.focus();
  }

  private onEscape(): boolean {
    if (this.tabs[this.activeTab].query) {
      this.resetSearch();
      return true;
    }
    // TodoPaper: Escape hides the window to the tray when enabled, otherwise quits
    if (this.platform.kind === "tauri") void (this.settings.minimizeToTray ? this.hideToTray() : this.quit());
    return true;
  }

  // ------------------------------------------------------------ quick log

  openQuickLog(): void {
    void this.platform.showQuickLog({
      files: [this.summary(), ...this.summaries.values()],
      defaultProject: this.settings.inbox,
    });
  }

  private quickLogSubmit(text: string, project: string): void {
    const spec = cmd.addToProject(this.view.state, text, project || this.settings.inbox);
    if (!spec) return;
    this.view.dispatch(spec);
    toast(`Logged to ${project || this.settings.inbox}`);
  }

  // ------------------------------------------------------------ context menu

  private async showContextMenu(event: MouseEvent, pos: number): Promise<void> {
    const spelling = this.settings.spellCheck ? await this.spellingMenu(pos) : [];
    const state = this.view.state;
    const line = state.doc.lineAt(pos);
    const info = getOutline(state).infos[line.number - 1];
    const lines = this.selectedLines();
    const many = lines.length > 1;
    const word = many ? "Lines" : "Line";
    const blank = !many && !line.text.trim();
    const items: MenuItem[] = [...spelling];
    if (!many && info.type === "project") {
      items.push(
        { label: "Show This Project", action: () => this.setSearch(projectToken(info.name), { commit: true }) },
        {
          label: "Select Entire Project",
          action: () => this.dispatch({ selection: EditorSelection.range(line.from, state.doc.line(getOutline(state).end[line.number - 1] + 1).to) }),
        },
        SEPARATOR,
      );
    }
    const link = findLinks(line.text).find((s) => pos >= line.from + s.from && pos <= line.from + s.to);
    if (link) items.push({ label: "Open Link", action: () => void this.platform.openUrl(line.text.slice(link.from, link.to)) }, SEPARATOR);
    const tag = cmd.tagAt(state, pos);
    if (tag && !many) {
      const text = line.text.slice(tag.tag.from, tag.tag.to);
      items.push({ label: `Filter by ${text}`, action: () => this.toggleSearchToken(text) }, { label: `Remove ${text}`, action: () => this.run((s) => cmd.removeTagAt(s, pos)) }, SEPARATOR);
    }
    const outline = getOutline(state);
    const tags = collectTags(outline.infos, defaultTagList(this.settings));
    items.push({
      label: `Tag ${word}`,
      enabled: !blank && tags.length > 0,
      submenu: tags.map((t) => ({ label: t, action: () => this.run((s) => cmd.addTagLines(s, lines, t)) })),
    });
    const projects = listProjects(outline);
    items.push({
      label: `Move ${word} To`,
      enabled: !blank && projects.length > 0,
      submenu: projects.map((p) => ({ label: `${"   ".repeat(p.depth)}${p.name}`, action: () => this.run((s) => cmd.moveLinesToProject(s, lines, p.name)) })),
    });
    items.push({ label: `Archive ${word}`, enabled: !blank, action: () => this.run((s) => cmd.archiveLines(s, lines)) });
    items.push(
      SEPARATOR,
      { label: "Undo", shortcut: keyLabel("Mod-z"), action: () => this.undo() },
      { label: "Redo", shortcut: keyLabel("Mod-Shift-z"), action: () => this.redo() },
      SEPARATOR,
      { label: "Cut", shortcut: keyLabel("Mod-x"), enabled: !state.selection.main.empty, action: () => void this.copy(true) },
      { label: "Copy", shortcut: keyLabel("Mod-c"), enabled: !state.selection.main.empty, action: () => void this.copy() },
      { label: "Paste", shortcut: keyLabel("Mod-v"), action: () => void this.paste() },
      SEPARATOR,
      { label: "Select All", shortcut: keyLabel("Mod-a"), action: () => this.selectAll() },
    );
    showMenu(items, event.clientX, event.clientY);
  }

  // ------------------------------------------------------------ misc

  print(): void {
    printDocument(this.view.state, this.path ? baseName(this.path) : "Untitled", pageCss(this.state.pageSetup));
  }

  // ------------------------------------------------------------ spelling

  /** Check spelling of the visible lines soon (after edits or scrolling). */
  private scheduleSpellCheck(): void {
    window.clearTimeout(this.spellTimer);
    if (!this.settings.spellCheck) {
      if (this.view.state.field(spellingField).size) this.view.dispatch({ effects: setMisspellings.of([]) });
      return;
    }
    this.spellTimer = window.setTimeout(() => void this.runSpellCheck(), 400);
  }

  /** Mark misspelled words in the visible lines (system spell checker, else the webview's own). */
  async runSpellCheck(): Promise<void> {
    const state = this.view.state;
    const lines: number[] = [];
    for (const { from, to } of this.view.visibleRanges) {
      for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) if (!lines.includes(n)) lines.push(n);
    }
    const texts = lines.map((n) => state.doc.line(n).text);
    const result = await this.platform.spellCheck(texts, this.settings.spellCheckLanguage);
    if (result === null) {
      if (!this.nativeSpell) {
        this.nativeSpell = true;
        this.view.dispatch({ effects: compartments.spell.reconfigure(spellExt(this.settings.spellCheck)) });
      }
      return;
    }
    if (this.view.state.doc !== state.doc) return this.scheduleSpellCheck();
    const marks: [number, number][] = [];
    lines.forEach((n, i) => {
      const line = state.doc.line(n);
      for (const [start, length] of keepSpellingRanges(line.text, result[i] ?? [])) marks.push([line.from + start, line.from + start + length]);
    });
    this.view.dispatch({ effects: setMisspellings.of(marks) });
  }

  /** Context menu entries for a misspelled word at `pos` (suggestions and Add Word). */
  private async spellingMenu(pos: number): Promise<MenuItem[]> {
    const hit = misspellingAt(this.view.state, pos);
    if (!hit) return [];
    const word = this.view.state.sliceDoc(hit.from, hit.to);
    const lang = this.settings.spellCheckLanguage;
    const suggestions = await this.platform.spellSuggest(word, lang);
    const items: MenuItem[] = [{ label: "Spelling Suggestions", header: true }];
    if (suggestions.length) {
      for (const s of suggestions.slice(0, 8)) {
        items.push({ label: s, action: () => this.dispatch({ changes: { from: hit.from, to: hit.to, insert: s }, userEvent: "input.spelling" }) });
      }
    } else items.push({ label: "No Suggestions Available", enabled: false });
    items.push(SEPARATOR, {
      label: "Add Word to Dictionary",
      action: async () => {
        await this.platform.spellAdd(word, lang);
        await this.runSpellCheck();
      },
    });
    return [{ label: "Spelling", submenu: items }, SEPARATOR];
  }

  openMenu(index: number): void {
    closeMenus();
    this.menuBar.open(index);
  }

  /** Recent files submenu. */
  recentMenu(): MenuItem[] {
    const items: MenuItem[] = this.state.recentFiles.map((p) => ({ label: p, action: () => void this.openFile(p) }));
    if (!items.length) items.push({ label: "No recent files", enabled: false });
    items.push(SEPARATOR, { label: "Clear Recent Files", action: () => this.clearRecent() });
    return items;
  }
}
