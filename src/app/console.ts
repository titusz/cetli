/**
 * The console (Ctrl+`): run code against the open document. Like TodoPaper's
 * console it runs Python with `self` as the editor (when Python is installed);
 * it also runs JavaScript with the plugin API available as `cetli`.
 */

import type { App } from "./app";
import { openModal } from "./modal";
import { createApi, importModule } from "./plugins";
import { pythonHost } from "./python";

export type ConsoleLanguage = "python" | "javascript";

const PLACEHOLDERS: Record<ConsoleLanguage, string> = {
  python: 'e.g.  print(self.GetLineCount())\n      self.AddToInbox("call Bob")',
  javascript: 'e.g.  return cetli.lineCount()\n      cetli.addToProject("- call Bob", "Inbox")',
};

/** The language chosen last in this session (null: Python when available, as in TodoPaper). */
let lastLanguage: ConsoleLanguage | null = null;

/** Run JavaScript console code; returns a printable result. */
export async function runConsoleCode(app: App, code: string): Promise<string> {
  const api = createApi(app, { name: "console", path: "", items: [] }, app.pluginHooks);
  try {
    const mod = await importModule(`export default async function (cetli) {\n${code}\n}`);
    const result = await (mod.default as (api: unknown) => unknown)(api);
    if (result === undefined) return "Command completed successfully";
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err) {
    return String(err);
  }
}

/** Run Python console code in the plugin bridge; returns printed output and the outcome. */
export async function runPythonConsoleCode(app: App, code: string): Promise<string> {
  const host = await pythonHost(app);
  if (!host) return "Python is not installed. Install it from python.org, or switch the console to JavaScript.";
  return host.console(code);
}

/** Create the language chooser; the Python entry shows the version once Python has started. */
function languageSelect(app: App, onChange: (lang: ConsoleLanguage) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "console-language";
  select.setAttribute("aria-label", "Language");
  for (const [value, label] of [["python", "Python"], ["javascript", "JavaScript"]]) select.add(new Option(label, value));
  const desktop = app.platform.kind === "tauri";
  select.value = lastLanguage ?? (desktop ? "python" : "javascript");
  select.onchange = () => onChange((lastLanguage = select.value as ConsoleLanguage));
  if (!desktop) {
    select.options[0].text = "Python (desktop app only)";
    return select;
  }
  void pythonHost(app).then((host) => {
    select.options[0].text = host ? host.description : "Python (not installed)";
    if (!host && !lastLanguage) onChange((select.value = "javascript") as ConsoleLanguage);
  });
  return select;
}

/** Open the console dialog. */
export function showConsole(app: App): void {
  const body = document.createElement("div");
  body.className = "console";
  const input = document.createElement("textarea");
  input.className = "console-input";
  input.spellcheck = false;
  const select = languageSelect(app, (lang) => (input.placeholder = PLACEHOLDERS[lang]));
  input.placeholder = PLACEHOLDERS[select.value as ConsoleLanguage];
  const run = document.createElement("button");
  run.type = "button";
  run.textContent = "Run Command (Ctrl+Enter)";
  const output = document.createElement("pre");
  output.className = "console-output";
  const execute = async () => {
    output.textContent = "…";
    const runner = select.value === "python" ? runPythonConsoleCode : runConsoleCode;
    output.textContent = await runner(app, input.value);
  };
  run.onclick = () => void execute();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void execute();
    }
  });
  const bar = document.createElement("div");
  bar.className = "console-bar";
  bar.append(select, run);
  body.append(input, bar, output);
  void openModal(body, [{ id: "close", label: "Close" }], { title: "Cetli Console", wide: true });
}
