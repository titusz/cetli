/**
 * TodoPaper's Python plugins and Python console.
 *
 * Cetli's bridge script (src-tauri/src/python/cetli_bridge.py) runs in the
 * installed Python (2.7 preferred, so TodoPaper plugins run unchanged) and
 * exchanges JSON lines with this module. Cetli asks the bridge to load plugin
 * files (*.py in the plugins folder), run menu items, the "on_start" mount
 * point, tag callbacks and console code; while plugin code runs, the bridge
 * asks Cetli to run editor methods (pyeditor.ts). Python starts only when
 * Python plugins exist or the console runs Python.
 */

import type { App } from "./app";
import type { Platform, PythonProcess } from "../platform/platform";
import type { LoadedPlugin, TagChange } from "./plugins";
import { EditorHost, editorCall } from "./pyeditor";
import { endUndoGroup } from "../editor/undogroup";
import { toast } from "./modal";

/** A menu group reported by the bridge after loading plugin files. */
export interface PyPluginReport {
  index: number;
  name: string;
  path: string;
  items: { label: string; key: string }[];
  error?: string;
}

/** A reply of the bridge to a request. */
export interface PyReply {
  type: string;
  output?: string;
  error?: string | null;
  plugins?: PyPluginReport[];
}

type CallHandler = (name: string, args: unknown[], kwargs?: Record<string, unknown>) => unknown;

/** True for Python plugin files (sources, or TodoPaper's compiled *.todopaper.plugin). */
export function isPythonPlugin(path: string): boolean {
  return /(\.py|\.todopaper\.plugin)$/i.test(path);
}

/** JSON with non-ASCII characters escaped, so the pipe's text encoding never matters. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^ -~]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

const WX_KEYS: Record<string, string> = {
  pgup: "PageUp",
  pgdn: "PageDown",
  del: "Delete",
  delete: "Delete",
  ins: "Insert",
  insert: "Insert",
  esc: "Escape",
  escape: "Escape",
  return: "Enter",
  enter: "Enter",
  space: "Space",
  tab: "Tab",
  back: "Backspace",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  home: "Home",
  end: "End",
};

const WX_MODIFIERS: Record<string, string> = { ctrl: "Mod", control: "Mod", alt: "Alt", shift: "Shift", cmd: "Mod", meta: "Meta" };

/** CodeMirror key name for a TodoPaper (wxWidgets) accelerator such as "Ctrl+Alt+H". */
export function wxKey(accelerator: string | undefined): string | undefined {
  const parts = (accelerator ?? "").split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return undefined;
  const mods = parts.map((m) => WX_MODIFIERS[m.toLowerCase()] ?? m);
  const name = WX_KEYS[key.toLowerCase()] ?? (key.length === 1 ? key.toLowerCase() : key);
  return [...mods, name].join("-");
}

/** Last line of a Python traceback: the exception and its message. */
export function exceptionLine(traceback: string): string {
  return traceback.trim().split("\n").pop()?.trim() ?? traceback;
}

/** A running bridge: serialized requests, editor calls answered while they run. */
export class PythonHost {
  /** Python version, e.g. "2.7.18". */
  version = "";
  alive = true;
  private proc!: PythonProcess;
  private pending: ((reply: PyReply) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private onReady: () => void = () => {};

  private constructor(
    private readonly onCall: CallHandler,
    private readonly onIdle: () => void,
  ) {}

  /** Start the bridge and wait until it is ready (rejects when Python is unavailable); onIdle runs after each request. */
  static async start(platform: Platform, onCall: CallHandler, onIdle: () => void = () => {}): Promise<PythonHost> {
    const host = new PythonHost(onCall, onIdle);
    const ready = new Promise<void>((resolve, reject) => {
      host.onReady = resolve;
      setTimeout(() => reject(new Error("Python did not start")), 15000);
    });
    ready.catch(() => {});
    host.proc = await platform.startPython((line) => host.receive(line), () => host.end("Python stopped unexpectedly"));
    try {
      await ready;
    } catch (err) {
      await host.stop();
      throw err;
    }
    return host;
  }

  /** Interpreter and version, e.g. "Python 2.7.18 (py -2)". */
  get description(): string {
    return `Python ${this.version} (${this.proc.interpreter})`;
  }

  /** Handle one line from the bridge. */
  private receive(line: string): void {
    let msg: { type?: string; version?: string; name?: string; args?: unknown[]; kwargs?: Record<string, unknown> };
    try {
      msg = JSON.parse(line);
    } catch {
      console.warn(`Python: ${line}`);
      return;
    }
    if (msg.type === "ready") {
      this.version = msg.version ?? "";
      this.onReady();
    } else if (msg.type === "call") {
      void this.answer(msg.name ?? "", msg.args ?? [], msg.kwargs);
    } else {
      const resolve = this.pending;
      this.pending = null;
      resolve?.(msg as PyReply);
    }
  }

  /** Run an editor method for the bridge and send back its result or error. */
  private async answer(name: string, args: unknown[], kwargs?: Record<string, unknown>): Promise<void> {
    let reply: object;
    try {
      reply = { type: "result", value: (await this.onCall(name, args, kwargs)) ?? null };
    } catch (err) {
      reply = { type: "result", error: err instanceof Error ? err.message : String(err) };
    }
    await this.proc.send(asciiJson(reply)).catch(() => {});
  }

  /** The bridge is gone: fail the request in progress. */
  private end(error: string): void {
    this.alive = false;
    const resolve = this.pending;
    this.pending = null;
    resolve?.({ type: "done", output: "", error });
  }

  /** Send a request after the previous ones finished; resolves with the bridge's reply. */
  private request(msg: object): Promise<PyReply> {
    const run = () =>
      new Promise<PyReply>((resolve) => {
        if (!this.alive) return resolve({ type: "done", output: "", error: "Python is not running" });
        this.pending = resolve;
        this.proc.send(asciiJson(msg)).catch((err) => {
          this.pending = null;
          resolve({ type: "done", output: "", error: String(err) });
        });
      });
    const result = this.queue.then(run).then((reply) => {
      this.onIdle();
      return reply;
    });
    this.queue = result;
    return result;
  }

  async load(files: string[]): Promise<PyPluginReport[]> {
    return (await this.request({ type: "load", files })).plugins ?? [];
  }

  run(plugin: number, item: number): Promise<PyReply> {
    return this.request({ type: "run", plugin, item });
  }

  mount(name: string): Promise<PyReply> {
    return this.request({ type: "mount", name });
  }

  /** Tell the plugins a tag was added to or removed from a (0-based) line. */
  tag(tag: string, line: number, deleted: boolean): Promise<PyReply> {
    return this.request({ type: "tag", tag, line, deleted });
  }

  /** Run console code with `self` as the editor; returns printed output and the outcome. */
  async console(code: string): Promise<string> {
    const reply = await this.request({ type: "console", code });
    return [reply.output, reply.error].filter(Boolean).join("\n");
  }

  async stop(): Promise<void> {
    this.end("Python was stopped");
    await this.proc?.stop().catch(() => {});
  }
}

/** Key under which tag hooks are registered ("@name", lower case). */
function tagKey(tag: string): string {
  return "@" + tag.replace(/^@/, "").toLowerCase();
}

/** Log a plugin's printed output; show its error the way TodoPaper did. */
function report(app: App, reply: PyReply): void {
  if (reply.output?.trim()) console.info(reply.output.trimEnd());
  if (!reply.error) return;
  console.warn(reply.error);
  void app.platform.alert(`There was an error running your plugin:\n\n${exceptionLine(reply.error)}`, "Plugin Error");
}

/** Start a bridge whose editor is the app's editor (rejects when Python is unavailable). */
async function startHost(app: App): Promise<PythonHost> {
  let host: PythonHost | null = null;
  const forwarders = new Map<string, (e: TagChange) => void>();
  const editor: EditorHost = {
    state: () => app.view.state,
    dispatch: (spec) => app.view.dispatch(spec),
    eol: () => app.meta.lineEnding,
    runAction: (id) => app.runAction(id),
    setSearch: (query) => app.setSearch(query, { commit: true }),
    save: () => app.save(),
    watchTag(tag) {
      const key = tagKey(tag);
      const hooks = app.pluginHooks.tags.get(key) ?? [];
      const existing = forwarders.get(key);
      if (existing && hooks.includes(existing)) return;
      const forward = (e: TagChange) => void host?.tag(tag, e.line - 1, !e.added).then((r) => report(app, r));
      forwarders.set(key, forward);
      app.pluginHooks.tags.set(key, [...hooks, forward]);
    },
    unwatchTag(tag) {
      const key = tagKey(tag);
      const forward = forwarders.get(key);
      forwarders.delete(key);
      app.pluginHooks.tags.set(key, (app.pluginHooks.tags.get(key) ?? []).filter((f) => f !== forward));
    },
  };
  const closeUndoGroups = () => endUndoGroup(app.view.state, true).forEach((spec) => app.view.dispatch(spec));
  host = await PythonHost.start(app.platform, (name, args, kwargs) => editorCall(editor, name, args, kwargs), closeUndoGroups);
  return host;
}

const hosts = new WeakMap<App, Promise<PythonHost | null>>();

/** The app's bridge, started on first use (or restarted); null when Python is unavailable. */
export function pythonHost(app: App, restart = false): Promise<PythonHost | null> {
  const current = hosts.get(app);
  if (current && !restart) return current;
  const next = (async () => {
    await (await current)?.stop();
    try {
      return await startHost(app);
    } catch (err) {
      console.warn(`Python is not available: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  })();
  hosts.set(app, next);
  return next;
}

/** The running bridge, if it was started. */
export function runningPython(app: App): Promise<PythonHost | null> {
  return hosts.get(app) ?? Promise.resolve(null);
}

/** File name without folders and extensions. */
function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).split(".")[0];
}

/** Load Python plugin files into a fresh bridge; returns their Tools > Plugins entries. */
export async function loadPythonPlugins(app: App, paths: string[]): Promise<LoadedPlugin[]> {
  if (!paths.length) return [];
  const host = await pythonHost(app, true);
  if (!host) {
    toast("Python plugins need Python, which is not installed (python.org)");
    return paths.map((path) => ({ name: fileStem(path), path, items: [], error: "Python is not installed" }));
  }
  return (await host.load(paths)).map((r) => {
    if (r.error) {
      console.warn(`Plugin ${r.path} failed to load: ${r.error}`);
      toast(`Plugin file (${r.name}) failed to load`);
    }
    const items = r.items.map((it, i) => ({ label: it.label, key: wxKey(it.key), run: () => void host.run(r.index, i).then((reply) => report(app, reply)) }));
    return { name: r.name, path: r.path, items, error: r.error };
  });
}

/** Run the plugins' "on_start" mount point, as TodoPaper did after opening its window. */
export async function startPythonPlugins(app: App): Promise<void> {
  const host = await runningPython(app);
  if (host) report(app, await host.mount("on_start"));
}
