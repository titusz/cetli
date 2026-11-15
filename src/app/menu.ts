/**
 * Popup menus (with submenus and keyboard navigation) and the menu bar.
 */

export interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  submenu?: MenuItem[];
  enabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  header?: boolean;
}

export const SEPARATOR: MenuItem = { separator: true };

interface OpenMenu {
  el: HTMLElement;
  items: MenuItem[];
  rows: HTMLElement[];
  active: number;
  child: OpenMenu | null;
  parent: OpenMenu | null;
}

let root: OpenMenu | null = null;
let onRootClose: (() => void) | null = null;
let navigateBar: ((dir: -1 | 1) => void) | null = null;

/** Close all open menus. */
export function closeMenus(): void {
  if (!root) return;
  let m: OpenMenu | null = root;
  while (m) {
    m.el.remove();
    m = m.child;
  }
  root = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  const cb = onRootClose;
  onRootClose = null;
  navigateBar = null;
  cb?.();
}

/** Close menus when clicking outside of them. */
function onOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest(".menu") || target.closest(".menubar-item")) return;
  closeMenus();
}

/** The deepest open menu. */
function deepest(): OpenMenu | null {
  let m = root;
  while (m?.child) m = m.child;
  return m;
}

/** Keyboard navigation inside menus. */
function onKey(e: KeyboardEvent) {
  const m = deepest();
  if (!m) return;
  const enabledRows = m.items.map((it, i) => (it.separator || it.header || it.enabled === false ? -1 : i)).filter((i) => i >= 0);
  const move = (dir: number) => {
    if (!enabledRows.length) return;
    const pos = enabledRows.indexOf(m.active);
    const next = enabledRows[(pos + dir + enabledRows.length) % enabledRows.length] ?? enabledRows[0];
    setActive(m, next);
  };
  let handled = true;
  if (e.key === "ArrowDown") move(1);
  else if (e.key === "ArrowUp") move(-1);
  else if (e.key === "ArrowRight") {
    const item = m.items[m.active];
    if (item?.submenu) openSubmenu(m, m.active, true);
    else if (navigateBar) navigateBar(1);
  } else if (e.key === "ArrowLeft") {
    if (m.parent) {
      m.el.remove();
      m.parent.child = null;
    } else if (navigateBar) navigateBar(-1);
  } else if (e.key === "Enter" || e.key === " ") {
    const item = m.items[m.active];
    if (item?.submenu) openSubmenu(m, m.active, true);
    else if (item) activate(item);
  } else if (e.key === "Escape") closeMenus();
  else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Highlight a row. */
function setActive(m: OpenMenu, index: number) {
  m.rows.forEach((r, i) => r.classList.toggle("active", i === index));
  m.active = index;
}

/** Run an item's action and close menus. */
function activate(item: MenuItem) {
  if (item.enabled === false || item.separator || item.header) return;
  closeMenus();
  item.action?.();
}

/** Build and position a menu element. */
function buildMenu(items: MenuItem[], x: number, y: number, parent: OpenMenu | null): OpenMenu {
  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "menu");
  const m: OpenMenu = { el, items, rows: [], active: -1, child: null, parent };
  items.forEach((item, i) => {
    const row = document.createElement("div");
    if (item.separator) {
      row.className = "menu-separator";
    } else {
      row.className = "menu-item" + (item.header ? " menu-header" : "") + (item.enabled === false ? " disabled" : "");
      row.setAttribute("role", "menuitem");
      const check = document.createElement("span");
      check.className = "menu-check";
      check.textContent = item.checked ? "✓" : "";
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = item.label ?? "";
      const extra = document.createElement("span");
      extra.className = "menu-shortcut";
      extra.textContent = item.submenu ? "▸" : (item.shortcut ?? "");
      row.append(check, label, extra);
      row.onmouseenter = () => {
        if (item.header) return;
        setActive(m, i);
        if (m.child) {
          m.child.el.remove();
          m.child = null;
        }
        if (item.submenu && item.enabled !== false) openSubmenu(m, i, false);
      };
      row.onmousedown = (e) => e.preventDefault();
      row.onclick = () => {
        if (item.submenu) openSubmenu(m, i, false);
        else activate(item);
      };
    }
    m.rows.push(row);
    el.appendChild(row);
  });
  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  el.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  el.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
  return m;
}

/** Open the submenu of row `index`. */
function openSubmenu(m: OpenMenu, index: number, focusFirst: boolean) {
  const item = m.items[index];
  if (!item.submenu) return;
  if (m.child) m.child.el.remove();
  const rowRect = m.rows[index].getBoundingClientRect();
  const child = buildMenu(item.submenu, rowRect.right - 2, rowRect.top - 4, m);
  if (rowRect.right + child.el.offsetWidth > window.innerWidth) {
    child.el.style.left = `${Math.max(4, rowRect.left - child.el.offsetWidth + 2)}px`;
  }
  m.child = child;
  if (focusFirst) {
    const first = item.submenu.findIndex((it) => !it.separator && !it.header && it.enabled !== false);
    if (first >= 0) setActive(child, first);
  }
}

/** Show a popup menu at a screen position. */
export function showMenu(items: MenuItem[], x: number, y: number, opts: { onClose?: () => void; selectFirst?: boolean } = {}): void {
  closeMenus();
  root = buildMenu(items, x, y, null);
  onRootClose = opts.onClose ?? null;
  if (opts.selectFirst) {
    const first = items.findIndex((it) => !it.separator && !it.header && it.enabled !== false);
    if (first >= 0) setActive(root, first);
  }
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}

export interface MenuBarMenu {
  label: string;
  items: () => MenuItem[];
}

/** Render a menu bar into `container`. */
export function renderMenuBar(container: HTMLElement, menus: MenuBarMenu[]): { open: (index: number) => void } {
  container.innerHTML = "";
  container.setAttribute("role", "menubar");
  let openIndex = -1;
  const buttons: HTMLElement[] = [];
  const open = (index: number) => {
    const btn = buttons[index];
    const r = btn.getBoundingClientRect();
    showMenu(menus[index].items(), r.left, r.bottom, {
      selectFirst: true,
      onClose: () => {
        btn.classList.remove("open");
        if (openIndex === index) openIndex = -1;
      },
    });
    navigateBar = (dir) => open((index + dir + menus.length) % menus.length);
    openIndex = index;
    btn.classList.add("open");
  };
  menus.forEach((menu, i) => {
    const btn = document.createElement("div");
    btn.className = "menubar-item";
    btn.textContent = menu.label;
    btn.onmousedown = (e) => {
      e.preventDefault();
      if (openIndex === i) closeMenus();
      else open(i);
    };
    btn.onmouseenter = () => {
      if (openIndex >= 0 && openIndex !== i) open(i);
    };
    buttons.push(btn);
    container.appendChild(btn);
  });
  return { open };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Turn a Tauri accelerator ("CommandOrControl+Shift+IntlBackslash") into a display label ("Ctrl+Shift+<"). */
export function acceleratorLabel(acc: string): string {
  const names: Record<string, string> = {
    CommandOrControl: isMac ? "⌘" : "Ctrl", Control: "Ctrl", Alt: isMac ? "⌥" : "Alt", Shift: isMac ? "⇧" : "Shift", Super: isMac ? "⌘" : "Win",
    IntlBackslash: "<", Backquote: "`", Semicolon: ";", Equal: "=", Comma: ",", Minus: "-", Period: ".", Slash: "/",
    BracketLeft: "[", BracketRight: "]", Backslash: "\\", Quote: "'",
  };
  return acc
    .split("+")
    .filter(Boolean)
    .map((p) => names[p] ?? p.replace(/^Key/, "").replace(/^Digit/, ""))
    .join(isMac ? "" : "+");
}

/** Turn a CodeMirror key spec ("Mod-Shift-a") into a display label ("Ctrl+Shift+A"). */
export function keyLabel(key: string | undefined): string {
  if (!key) return "";
  const names: Record<string, string> = {
    Mod: isMac ? "⌘" : "Ctrl", Ctrl: "Ctrl", Alt: isMac ? "⌥" : "Alt", Shift: isMac ? "⇧" : "Shift", Meta: "⌘",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", PageUp: "PgUp", PageDown: "PgDn",
  };
  const parts = key.split(/-(?!$)/);
  return parts.map((p) => names[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join(isMac ? "" : "+");
}
