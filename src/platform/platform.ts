/**
 * Platform abstraction: everything the app needs from the host (files,
 * dialogs, config storage, windows, global shortcuts). The Tauri
 * implementation runs in the desktop app; the web implementation keeps files
 * in memory for development and end-to-end tests in a plain browser.
 */

export type LineEnding = "\n" | "\r\n" | "\r";

/** A loaded document plus what is needed to write it back unchanged. */
export interface FileData {
  text: string;
  lineEnding: LineEnding;
  encoding: string;
  bom: boolean;
  mtime: number;
}

/** Data found in an existing TodoPaper installation. */
export interface TodoPaperImport {
  settings: string | null;
  recentFiles: string[];
  searches: string[];
  zoom: number | null;
  opacity: number | null;
}

export type SaveChoice = "save" | "discard" | "cancel";

/** An open document offered by the quick log window. */
export interface QuickLogFile {
  /** Label of the window holding the document. */
  label: string;
  title: string;
  projects: { name: string; depth: number }[];
}

/** Payload sent to the quick log window when it opens. */
export interface QuickLogOpen {
  /** Open documents; the first is the window that opened the quick log. */
  files: QuickLogFile[];
  defaultProject: string;
}

/** Payload sent back from the quick log window. */
export interface QuickLogSubmit {
  text: string;
  project: string;
  /** Label of the window whose document receives the item. */
  target: string;
}

/** A plugin file and its source code. */
export interface PluginSource {
  path: string;
  code: string;
}

/** A running Python bridge process (see src-tauri/src/python.rs). */
export interface PythonProcess {
  /** Interpreter command line, e.g. "py -2". */
  interpreter: string;
  send(line: string): Promise<void>;
  stop(): Promise<void>;
}

export interface Platform {
  kind: "tauri" | "web";
  /** Label of this window ("main" for the first document window). */
  windowLabel: string;
  /** File to open in a newly created document window (from its URL). */
  windowFile(): string | null;
  primaryLabel(): Promise<string | null>;
  onPrimaryChanged(handler: () => void): void;
  newWindow(path?: string): Promise<void>;
  /** Send an event to all windows. */
  broadcast(event: string, payload: unknown): void;
  onBroadcast<T>(event: string, handler: (payload: T) => void): void;
  /** Set window opacity (0-255); false when unsupported. */
  setOpacity(alpha: number): Promise<boolean>;
  /** Resolve dropped files to paths; the result arrives through onFilesDropped. */
  dropFiles(files: FileList, pos: number): void;
  onFilesDropped(handler: (pos: number, paths: string[]) => void): void;
  listPlugins(): Promise<PluginSource[]>;
  pluginDir(): Promise<string | null>;
  /** Start the Python plugin bridge; rejects when Python is unavailable. */
  startPython(onLine: (line: string) => void, onExit: () => void): Promise<PythonProcess>;
  /** Misspelled [start, length] ranges per text; null when the system has no spell checker (use the webview's). */
  spellCheck(texts: string[], lang: string): Promise<[number, number][][] | null>;
  spellSuggest(word: string, lang: string): Promise<string[]>;
  spellAdd(word: string, lang: string): Promise<void>;
  /** Language tags with an installed dictionary (empty when unknown). */
  spellLanguages(): Promise<string[]>;
  /** Folder holding the configuration (null when not on disk). */
  configDir(): Promise<string | null>;
  readFile(path: string): Promise<FileData>;
  writeFile(path: string, text: string, meta: Pick<FileData, "lineEnding" | "encoding" | "bom">): Promise<number>;
  fileMtime(path: string): Promise<number | null>;
  deleteFile(path: string): Promise<void>;
  openDialog(): Promise<string | null>;
  saveDialog(defaultPath?: string): Promise<string | null>;
  askSave(message: string): Promise<SaveChoice>;
  confirm(message: string, title?: string): Promise<boolean>;
  alert(message: string, title?: string): Promise<void>;
  loadConfig(name: string): Promise<string | null>;
  saveConfig(name: string, contents: string): Promise<void>;
  setTitle(title: string): void;
  openUrl(url: string): Promise<void>;
  launchFiles(): Promise<string[]>;
  onOpenFiles(handler: (paths: string[]) => void): void;
  onCloseRequested(handler: () => Promise<boolean>): void;
  onTrayEvent(handler: (event: "quicklog" | "quit") => void): void;
  setTrayVisible(visible: boolean): Promise<void>;
  registerGlobalShortcut(accelerator: string, handler: () => void): Promise<boolean>;
  unregisterGlobalShortcuts(): Promise<void>;
  showQuickLog(payload: QuickLogOpen): Promise<void>;
  onQuickLogSubmit(handler: (payload: QuickLogSubmit) => void): void;
  minimize(): Promise<void>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  todoPaperImport(): Promise<TodoPaperImport>;
}

/** File name part of a path (handles both separators). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
