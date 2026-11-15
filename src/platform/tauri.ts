/** Platform implementation backed by the Tauri desktop shell. */

import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { FileData, Platform, PluginSource, QuickLogOpen, QuickLogSubmit, SaveChoice, TodoPaperImport } from "./platform";

const FILTERS = [
  { name: "Todo lists", extensions: ["taskpaper", "todopaper", "txt"] },
  { name: "TaskPaper", extensions: ["taskpaper"] },
  { name: "TodoPaper", extensions: ["todopaper"] },
  { name: "Text", extensions: ["txt"] },
  { name: "All files", extensions: ["*"] },
];

/** Convert a file:// URL to a local path. */
function fileUrlToPath(url: string): string {
  const path = decodeURIComponent(url.replace(/^file:\/\/\/?/i, ""));
  return /^[a-z]:/i.test(path) ? path : "/" + path.replace(/^\/+/, "");
}

/** Payload of the Python bridge events (see src-tauri/src/python.rs). */
interface PythonEvent {
  token: number;
  line?: string;
}

/** Identifies the latest Python bridge started by this window. */
let pythonToken = 0;

export function createTauriPlatform(): Platform {
  const win = getCurrentWindow();
  const webview = getCurrentWebviewWindow();
  let winHotkeyHandler: (() => void) | null = null;
  let dropHandler: ((pos: number, paths: string[]) => void) | null = null;
  void webview.listen("win-hotkey", () => winHotkeyHandler?.());
  return {
    kind: "tauri",
    windowLabel: webview.label,
    windowFile: () => new URLSearchParams(location.search).get("open"),
    primaryLabel: () => invoke<string | null>("primary_label"),
    onPrimaryChanged(handler) {
      void webview.listen("primary-changed", () => handler());
    },
    async newWindow(path) {
      await invoke("new_window", { path: path ?? null });
    },
    broadcast(event, payload) {
      void emit(event, payload);
    },
    onBroadcast(event, handler) {
      void listen(event, (e) => handler(e.payload as never));
    },
    async setOpacity(alpha) {
      try {
        await invoke("set_window_opacity", { alpha: Math.round(alpha) });
        return true;
      } catch {
        return false;
      }
    },
    dropFiles(files, pos) {
      type Bridge = { postMessageWithAdditionalObjects?: (message: string, objects: FileList) => void };
      const bridge = (window as unknown as { chrome?: { webview?: Bridge } }).chrome?.webview;
      try {
        bridge?.postMessageWithAdditionalObjects?.(`cetli-drop:${pos}`, files);
      } catch {
        dropHandler?.(pos, []); // e.g. an image dragged from a web page: not a file on disk
      }
    },
    onFilesDropped(handler) {
      dropHandler = handler;
      void webview.listen<{ pos: number; paths: string[] }>("files-dropped", (e) => handler(e.payload.pos, e.payload.paths));
    },
    async listPlugins() {
      const paths = await invoke<string[]>("list_plugins");
      const sources: PluginSource[] = [];
      // only JavaScript plugins are evaluated here; Python plugins are read by the Python bridge
      for (const path of paths) sources.push({ path, code: /\.js$/i.test(path) ? (await invoke<FileData>("read_text_file", { path })).text : "" });
      return sources;
    },
    pluginDir: () => invoke<string>("plugin_dir"),
    async startPython(onLine, onExit) {
      const token = ++pythonToken;
      const unlisten = await Promise.all([
        webview.listen<PythonEvent>("python-message", (e) => e.payload.token === token && onLine(e.payload.line ?? "")),
        webview.listen<PythonEvent>("python-stderr", (e) => e.payload.token === token && console.warn(`Python: ${e.payload.line}`)),
        webview.listen<PythonEvent>("python-exit", (e) => e.payload.token === token && onExit()),
      ]);
      const stopListening = () => unlisten.forEach((u) => u());
      try {
        const interpreter = await invoke<string>("python_start", { token });
        return {
          interpreter,
          send: (line: string) => invoke<void>("python_send", { token, line }),
          stop: async () => {
            stopListening();
            await invoke("python_stop", { token });
          },
        };
      } catch (err) {
        stopListening();
        throw new Error(String(err));
      }
    },
    async spellCheck(texts, lang) {
      try {
        return await invoke<[number, number][][]>("spell_check", { texts, lang });
      } catch {
        return null;
      }
    },
    spellSuggest: (word, lang) => invoke<string[]>("spell_suggest", { word, lang }).catch(() => []),
    spellAdd: (word, lang) => invoke<void>("spell_add", { word, lang }),
    spellLanguages: () => invoke<string[]>("spell_languages").catch(() => []),
    configDir: () => invoke<string>("config_dir").catch(() => null),
    readFile: (path) => invoke<FileData>("read_text_file", { path }),
    writeFile: (path, text, meta) => invoke<number>("write_text_file", { path, text, lineEnding: meta.lineEnding, encoding: meta.encoding, bom: meta.bom }),
    fileMtime: (path) => invoke<number | null>("file_mtime", { path }),
    deleteFile: (path) => invoke<void>("delete_file", { path }),
    async openDialog() {
      const picked = await open({ multiple: false, directory: false, filters: FILTERS });
      return typeof picked === "string" ? picked : null;
    },
    saveDialog: (defaultPath) => save({ defaultPath, filters: FILTERS }),
    async askSave(text) {
      const result = await message(text, { title: "Cetli", kind: "warning", buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" } });
      if (result === "Save" || result === "Yes") return "save";
      if (result === "Don't Save" || result === "No") return "discard";
      return "cancel" as SaveChoice;
    },
    confirm: (text, title = "Cetli") => ask(text, { title, kind: "warning" }),
    async alert(text, title = "Cetli") {
      await message(text, { title, kind: "info" });
    },
    loadConfig: (name) => invoke<string | null>("load_config", { name }),
    saveConfig: (name, contents) => invoke<void>("save_config", { name, contents }),
    setTitle(title) {
      void win.setTitle(title);
    },
    async openUrl(url) {
      if (/^file:/i.test(url)) await openPath(fileUrlToPath(url));
      else await openUrl(/^www\./i.test(url) ? "https://" + url : url);
    },
    launchFiles: () => invoke<string[]>("launch_files"),
    onOpenFiles(handler) {
      void webview.listen<string[]>("open-files", (e) => handler(e.payload));
    },
    onCloseRequested(handler) {
      void win.onCloseRequested(async (event) => {
        if (!(await handler())) event.preventDefault();
      });
    },
    onTrayEvent(handler) {
      void webview.listen("tray-quicklog", () => handler("quicklog"));
      void webview.listen("tray-quit", () => handler("quit"));
    },
    setTrayVisible: (visible) => invoke<void>("set_tray_visible", { visible }),
    async registerGlobalShortcut(accelerator, handler) {
      try {
        await register(accelerator, (e) => {
          if (e.state === "Pressed") handler();
        });
        return true;
      } catch (err) {
        // keys the plugin cannot parse (e.g. the ISO "<>" key) use a native Windows hotkey
        try {
          await invoke("register_win_hotkey", { accelerator });
          winHotkeyHandler = handler;
          return true;
        } catch (fallbackErr) {
          console.warn("Cannot register global shortcut", accelerator, err, fallbackErr);
          return false;
        }
      }
    },
    async unregisterGlobalShortcuts() {
      winHotkeyHandler = null;
      await unregisterAll();
      await invoke("unregister_win_hotkey");
    },
    async showQuickLog(payload: QuickLogOpen) {
      const ql = await WebviewWindow.getByLabel("quicklog");
      if (!ql) return;
      await emitTo("quicklog", "quicklog-open", payload);
      await ql.center();
      await ql.show();
      await ql.setFocus();
    },
    onQuickLogSubmit(handler) {
      void webview.listen<QuickLogSubmit>("quicklog-submit", (e) => handler(e.payload));
    },
    minimize: () => win.minimize(),
    hide: () => win.hide(),
    quit: () => win.destroy(),
    todoPaperImport: () => invoke<TodoPaperImport>("todopaper_import"),
  };
}
