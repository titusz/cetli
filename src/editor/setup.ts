/**
 * Assembles the CodeMirror editor for TodoPaper documents: state fields,
 * styling, gutter, keymaps, autocompletion, find/replace and mouse handling.
 * Reconfigurable parts live in compartments.
 */

import { Compartment, EditorState, Extension, Prec } from "@codemirror/state";
import { EditorView, ViewUpdate, drawSelection, dropCursor, highlightActiveLine, keymap } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { search } from "@codemirror/search";
import { autocompletion } from "@codemirror/autocomplete";
import { findLinks } from "../core/parser";
import { EditorConfig, editorConfig } from "./config";
import { outlineField } from "./model";
import { visibilityField } from "./visibility";
import { spellingField } from "./spelling";
import { CustomStyleRule, customStyleRules, highlightPlugin } from "./highlight";
import { taskGutter } from "./gutter";
import { tagCompletions } from "./autocomplete";
import { editorKeys, standardKeys } from "./keymap";
import { tagAt } from "./commands";
import { undoGroups } from "./undogroup";

export interface EditorHooks {
  /** Ctrl/Cmd-click on a tag; receives the full tag text, e.g. "@due(2026-01-01)". */
  onTagClick(tag: string): void;
  /** Ctrl/Cmd-click on a project line; receives the project name. */
  onProjectClick(name: string): void;
  /** Ctrl/Cmd-click on a link. */
  onLinkClick(url: string): void;
  /** Right click at a document position. */
  onContextMenu(event: MouseEvent, pos: number): void;
  /** Escape pressed with nothing else to cancel. */
  onEscape(): boolean;
  /** Files dropped onto the editor at a document position. */
  onDropFiles(files: FileList, pos: number): void;
  /** Every view update. */
  onUpdate(update: ViewUpdate): void;
}

export interface EditorOptions {
  config: Partial<EditorConfig>;
  wordWrap: boolean;
  activeLine: boolean;
  spellCheck: boolean;
  customStyles: CustomStyleRule[];
}

export const compartments = {
  config: new Compartment(),
  wrap: new Compartment(),
  activeLine: new Compartment(),
  custom: new Compartment(),
  spell: new Compartment(),
  appKeys: new Compartment(),
};

/** Extension for the word wrap option. */
export const wrapExt = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);
/** Extension for the active line highlight option. */
export const activeLineExt = (on: boolean): Extension => (on ? highlightActiveLine() : []);
/** Extension for spell checking. */
export const spellExt = (on: boolean): Extension => EditorView.contentAttributes.of({ spellcheck: on ? "true" : "false", autocorrect: "off", autocapitalize: "off" });

/** Handle Ctrl/Cmd-click on tags, links and projects. */
function modClick(view: EditorView, event: MouseEvent, hooks: EditorHooks): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.button !== 0 || event.shiftKey || event.altKey) return false;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return false;
  const line = view.state.doc.lineAt(pos);
  const link = findLinks(line.text).find((s) => pos >= line.from + s.from && pos <= line.from + s.to);
  if (link) {
    hooks.onLinkClick(line.text.slice(link.from, link.to));
    return true;
  }
  const tag = tagAt(view.state, pos);
  if (tag) {
    hooks.onTagClick(line.text.slice(tag.tag.from, tag.tag.to));
    return true;
  }
  const info = view.state.field(outlineField).infos[line.number - 1];
  if (info?.type === "project") {
    hooks.onProjectClick(info.name);
    return true;
  }
  return false;
}

/** Build all editor extensions. */
export function editorExtensions(hooks: EditorHooks, opts: EditorOptions): Extension[] {
  return [
    history(),
    undoGroups,
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of("\t"),
    EditorState.tabSize.of(4),
    outlineField,
    visibilityField,
    spellingField,
    highlightPlugin,
    taskGutter,
    autocompletion({ override: [tagCompletions], icons: false, closeOnBlur: true, activateOnTypingDelay: 0 }),
    search({ top: true }),
    compartments.config.of(editorConfig.of(opts.config)),
    compartments.wrap.of(wrapExt(opts.wordWrap)),
    compartments.activeLine.of(activeLineExt(opts.activeLine)),
    compartments.custom.of(customStyleRules.of(opts.customStyles)),
    compartments.spell.of(spellExt(opts.spellCheck)),
    Prec.high(keymap.of(editorKeys(() => hooks.onEscape()))),
    compartments.appKeys.of([]),
    keymap.of(standardKeys),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (modClick(view, event, hooks)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files || !files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        hooks.onDropFiles(files, pos);
        return true;
      },
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const sel = view.state.selection.main;
        if (pos < sel.from || pos > sel.to) view.dispatch({ selection: { anchor: pos } });
        event.preventDefault();
        hooks.onContextMenu(event, pos);
        return true;
      },
    }),
    EditorView.updateListener.of((u) => hooks.onUpdate(u)),
  ];
}
