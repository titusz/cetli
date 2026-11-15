/**
 * Quick Log: a small popup for jotting a task into a project from anywhere
 * (opened by a global hotkey). In the desktop app it runs in its own
 * always-on-top window; in the browser build it is an in-page overlay.
 * With several documents open it offers a file choice, defaulting to the
 * last file logged to (as TodoPaper did).
 */

import type { QuickLogFile, QuickLogOpen, QuickLogSubmit } from "../platform/platform";

const LAST_PROJECT_KEY = "cetli.quicklog.project";
const LAST_FILE_KEY = "cetli.quicklog.file";

/** Read a remembered value (storage may be unavailable). */
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remember a value. */
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Fill the project select for a file, keeping the default project available. */
function fillProjects(select: HTMLSelectElement, file: QuickLogFile | undefined, defaultProject: string): void {
  select.innerHTML = "";
  const projects = file?.projects ?? [];
  const hasDefault = projects.some((p) => p.name.toLowerCase() === defaultProject.toLowerCase());
  const options = hasDefault ? projects : [{ name: defaultProject, depth: 0 }, ...projects];
  for (const p of options) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = `${"   ".repeat(p.depth)}${p.name}`;
    select.appendChild(opt);
  }
  const preferred = recall(LAST_PROJECT_KEY);
  select.value = preferred && options.some((o) => o.name === preferred) ? preferred : defaultProject;
}

/** Build the quick log form; calls `submit` or `close`. */
export function renderQuickLog(container: HTMLElement, data: QuickLogOpen, submit: (p: QuickLogSubmit) => void, close: () => void): void {
  container.innerHTML = "";
  const form = document.createElement("form");
  form.className = "quicklog";
  form.innerHTML = `
    <div class="quicklog-head" data-tauri-drag-region>
      <span class="quicklog-title" data-tauri-drag-region>Quick Log to</span>
      <select class="quicklog-project" aria-label="Project"></select>
      <span class="quicklog-in" data-tauri-drag-region>in</span>
      <select class="quicklog-files" aria-label="File"></select>
      <span class="quicklog-file" data-tauri-drag-region></span>
      <button type="button" class="quicklog-close" title="Close (Esc)">×</button>
    </div>
    <textarea class="quicklog-text" rows="2" spellcheck="false" aria-label="Item"></textarea>
    <div class="quicklog-hint" data-tauri-drag-region>Enter: log · Shift+Enter: another line · Esc: cancel</div>`;
  container.appendChild(form);
  const select = form.querySelector<HTMLSelectElement>(".quicklog-project")!;
  const files = form.querySelector<HTMLSelectElement>(".quicklog-files")!;
  const text = form.querySelector<HTMLTextAreaElement>(".quicklog-text")!;
  const many = data.files.length > 1;
  files.hidden = !many;
  form.querySelector<HTMLElement>(".quicklog-in")!.hidden = !many;
  data.files.forEach((f, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = f.title;
    files.appendChild(opt);
  });
  const lastFile = recall(LAST_FILE_KEY);
  files.value = String(Math.max(0, data.files.findIndex((f) => f.title === lastFile)));
  const current = (): QuickLogFile | undefined => data.files[Number(files.value)] ?? data.files[0];
  form.querySelector<HTMLElement>(".quicklog-file")!.textContent = many ? "" : (data.files[0]?.title ?? "");
  fillProjects(select, current(), data.defaultProject);
  files.onchange = () => fillProjects(select, current(), data.defaultProject);
  text.value = "- ";
  const send = () => {
    const value = text.value;
    const file = current();
    if (!value.replace(/^\s*-\s*/gm, "").trim() || !file) return close();
    remember(LAST_PROJECT_KEY, select.value);
    remember(LAST_FILE_KEY, file.title);
    submit({ text: value, project: select.value, target: file.label });
    close();
  };
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      const pos = text.selectionStart;
      text.setRangeText("\n- ", pos, text.selectionEnd, "end");
    }
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  form.querySelector<HTMLButtonElement>(".quicklog-close")!.onclick = close;
  text.focus();
  text.setSelectionRange(text.value.length, text.value.length);
}

/** In-page overlay variant (browser build). */
export function openQuickLogOverlay(data: QuickLogOpen, submit: (p: QuickLogSubmit) => void): void {
  document.getElementById("quicklog-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "quicklog-overlay";
  overlay.className = "modal-backdrop";
  const box = document.createElement("div");
  box.className = "quicklog-box";
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  renderQuickLog(box, data, submit, () => overlay.remove());
}

/** Entry point for the dedicated quick log window (desktop app). */
export async function runQuickLogWindow(): Promise<void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { emitTo } = await import("@tauri-apps/api/event");
  const win = getCurrentWebviewWindow();
  document.body.classList.add("quicklog-window");
  const root = document.getElementById("app")!;
  const hide = () => void win.hide();
  await win.listen<QuickLogOpen>("quicklog-open", (e) => {
    renderQuickLog(root, e.payload, (p) => void emitTo(p.target, "quicklog-submit", p), hide);
  });
  window.addEventListener("focus", () => root.querySelector<HTMLTextAreaElement>(".quicklog-text")?.focus());
  window.addEventListener("blur", () => setTimeout(() => !document.hasFocus() && hide(), 150));
}
