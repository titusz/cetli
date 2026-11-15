/**
 * Test helpers: build CodeMirror states from documents with cursor markers
 * and apply command transactions.
 */

import { EditorSelection, EditorState, TransactionSpec } from "@codemirror/state";
import { outlineField } from "../../src/editor/model";
import { visibilityField } from "../../src/editor/visibility";
import { EditorConfig, editorConfig } from "../../src/editor/config";

/**
 * Create a state from a document where "|" marks the cursor, or "[" and "]"
 * mark a selection (anchor at "[", head at "]").
 */
export function mk(doc: string, config: Partial<EditorConfig> = {}): EditorState {
  let text = doc;
  let selection = EditorSelection.single(0);
  const open = text.indexOf("[");
  const cursor = text.indexOf("|");
  if (open >= 0 && text.indexOf("]") > open) {
    const close = text.indexOf("]");
    text = text.slice(0, open) + text.slice(open + 1, close) + text.slice(close + 1);
    selection = EditorSelection.single(open, close - 1);
  } else if (cursor >= 0) {
    text = text.slice(0, cursor) + text.slice(cursor + 1);
    selection = EditorSelection.single(cursor);
  }
  return EditorState.create({
    doc: text,
    selection,
    extensions: [EditorState.allowMultipleSelections.of(true), outlineField, visibilityField, editorConfig.of(config)],
  });
}

/** Apply a transaction spec (or a list of them) and return the new state. */
export function apply(state: EditorState, spec: TransactionSpec | null): EditorState {
  if (!spec) return state;
  return state.update(spec).state;
}

/** Render a state's document with "|" at the main cursor (or "[...]" around the selection). */
export function show(state: EditorState): string {
  const { from, to, empty } = state.selection.main;
  const doc = state.doc.toString();
  if (empty) return doc.slice(0, from) + "|" + doc.slice(from);
  return doc.slice(0, from) + "[" + doc.slice(from, to) + "]" + doc.slice(to);
}

/** A fixed date used for deterministic date tags. */
export const NOW = new Date(2026, 10, 15, 9, 30, 0);
