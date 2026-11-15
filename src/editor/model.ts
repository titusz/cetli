/**
 * CodeMirror state field holding the parsed document outline.
 *
 * Line infos are re-parsed only for lines touched by a change; the (cheap,
 * regex-free) hierarchy pass then runs over all lines.
 */

import { EditorState, StateField, Text, Transaction } from "@codemirror/state";
import { LineInfo, parseLine } from "../core/parser";
import { Outline, outlineFromInfos } from "../core/outline";

/** Parse a range of document lines (1-based, inclusive) into infos. */
function parseRange(doc: Text, first: number, last: number): LineInfo[] {
  const infos: LineInfo[] = [];
  for (let n = first; n <= last; n++) infos.push(parseLine(doc.line(n).text));
  return infos;
}

/** Recompute line infos after a transaction, re-parsing only changed lines. */
function updateInfos(old: LineInfo[], tr: Transaction): LineInfo[] {
  const before = tr.startState.doc;
  const after = tr.state.doc;
  let firstA = Infinity, lastA = -1, firstB = Infinity, lastB = -1;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    firstA = Math.min(firstA, before.lineAt(fromA).number);
    lastA = Math.max(lastA, before.lineAt(toA).number);
    firstB = Math.min(firstB, after.lineAt(fromB).number);
    lastB = Math.max(lastB, after.lineAt(toB).number);
  });
  if (lastA < 0) return old;
  const head = old.slice(0, firstA - 1);
  const tail = old.slice(lastA);
  return head.concat(parseRange(after, firstB, lastB), tail);
}

export const outlineField = StateField.define<Outline>({
  create(state) {
    return outlineFromInfos(parseRange(state.doc, 1, state.doc.lines));
  },
  update(outline, tr) {
    if (!tr.docChanged) return outline;
    return outlineFromInfos(updateInfos(outline.infos, tr));
  },
});

/** Get the outline for a state. */
export function getOutline(state: EditorState): Outline {
  return state.field(outlineField);
}

/** Get all document lines as strings. */
export function docLines(doc: Text): string[] {
  const lines: string[] = [];
  for (const it = doc.iterLines(); !it.next().done; ) lines.push(it.value);
  return lines;
}
