/**
 * Editor key bindings that depend on the cursor context (Enter, Tab,
 * Escape), plus the standard CodeMirror keymaps without bindings that clash
 * with TodoPaper shortcuts.
 */

import { KeyBinding, EditorView } from "@codemirror/view";
import { defaultKeymap, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { enter } from "./commands";

/** Keys taken by Cetli; standard bindings using them are dropped. */
const RESERVED = new Set([
  "Mod-Enter", "Alt-ArrowUp", "Alt-ArrowDown", "Mod-[", "Mod-]", "Mod-i", "Mod-/", "Shift-Alt-a", "Alt-A",
  "Mod-d", "Mod-g", "Shift-Mod-g", "Mod-Alt-g", "Mod-y", "Mod-u", "Alt-u", "Shift-Mod-l", "Mod-Shift-l", "Shift-Mod-k",
  "Mod-Alt-ArrowUp", "Mod-Alt-ArrowDown", "Mod-Home", "Mod-End",
]);

/** Drop reserved keys from a keymap (bindings may have several key variants). */
function withoutReserved(bindings: readonly KeyBinding[]): KeyBinding[] {
  return bindings
    .map((b) => {
      const copy: KeyBinding = { ...b };
      for (const prop of ["key", "mac", "win", "linux"] as const) {
        if (copy[prop] && RESERVED.has(copy[prop] as string)) delete copy[prop];
      }
      return copy;
    })
    .filter((b) => b.key || b.mac || b.win || b.linux);
}

/** Dispatch the TodoPaper Enter behaviour. */
function runEnter(view: EditorView, opts: { shift?: boolean; ctrl?: boolean }): boolean {
  view.dispatch(enter(view.state, opts));
  return true;
}

/** Build the context-dependent editor keys. `onEscape` handles Escape when nothing else does. */
export function editorKeys(onEscape: () => boolean): KeyBinding[] {
  return [
    { key: "Tab", run: (v) => (completionStatus(v.state) === "active" ? (acceptCompletion(v), true) : indentMore(v)) },
    { key: "Shift-Tab", run: indentLess },
    { key: "Enter", run: (v) => runEnter(v, {}) },
    { key: "Shift-Enter", run: (v) => runEnter(v, { shift: true }) },
    { key: "Mod-Enter", run: (v) => runEnter(v, { ctrl: true }) },
    { key: "Mod-Shift-Enter", run: (v) => runEnter(v, { shift: true, ctrl: true }) },
    { key: "Escape", run: () => onEscape() },
  ];
}

/** Standard editing keymaps minus clashing bindings. */
export const standardKeys: KeyBinding[] = withoutReserved([...defaultKeymap, ...historyKeymap, ...searchKeymap]);
