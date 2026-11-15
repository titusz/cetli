/**
 * Minimal in-app modal dialogs and toast notifications.
 */

export interface ModalButton {
  id: string;
  label: string;
  primary?: boolean;
}

/** Show a modal with custom content; resolves with the clicked button id ("cancel" on Escape). */
export function openModal(content: HTMLElement, buttons: ModalButton[], opts: { title?: string; wide?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const box = document.createElement("div");
    box.className = "modal" + (opts.wide ? " modal-wide" : "");
    box.setAttribute("role", "dialog");
    if (opts.title) {
      const h = document.createElement("h2");
      h.textContent = opts.title;
      box.appendChild(h);
    }
    content.classList.add("modal-body");
    box.appendChild(content);
    const bar = document.createElement("div");
    bar.className = "modal-buttons";
    const close = (id: string) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
      resolve(id);
    };
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label;
      btn.dataset.id = b.id;
      if (b.primary) btn.className = "primary";
      btn.onclick = () => close(b.id);
      bar.appendChild(btn);
    }
    box.appendChild(bar);
    backdrop.appendChild(box);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(buttons.some((b) => b.id === "cancel") ? "cancel" : buttons[buttons.length - 1].id);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        const primary = buttons.find((b) => b.primary);
        if (primary && !(e.target instanceof HTMLInputElement && e.target.dataset.captureKeys)) {
          e.preventDefault();
          close(primary.id);
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    const focusTarget = box.querySelector<HTMLElement>("input, select, textarea") ?? box.querySelector<HTMLElement>("button.primary") ?? box.querySelector("button");
    focusTarget?.focus();
  });
}

/** Show a message with a set of buttons. */
export function modalChoice(message: string, buttons: ModalButton[], title?: string): Promise<string> {
  const p = document.createElement("div");
  p.className = "modal-message";
  p.textContent = message;
  return openModal(p, buttons, { title });
}

let toastTimer: number | undefined;

/** Show a short-lived notification at the bottom of the window. */
export function toast(message: string, ms = 2600): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove("visible"), ms);
}
