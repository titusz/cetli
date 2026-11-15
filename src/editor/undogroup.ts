/**
 * Undo groups: Scintilla's BeginUndoAction / EndUndoAction, used by TodoPaper
 * plugins. The changes made between the outermost begin and its matching end
 * become a single undo step; groups nest. While a group is open its
 * transactions stay out of the history; closing it reverts them and applies
 * their combined change as one isolated history event.
 */

import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, StateField, Text, Transaction, TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";

interface UndoGroup {
  depth: number;
  /** Document and selection when the outermost group began. */
  startDoc: Text | null;
  startSelection: EditorSelection | null;
  /** Changes made since then. */
  changes: ChangeSet | null;
}

const beginGroup = StateEffect.define<null>();
const endGroup = StateEffect.define<null>();

/** Marks the two transactions that turn a closed group into one undo step (they change nothing in effect). */
export const undoGroupReplay = Annotation.define<boolean>();

const CLOSED: UndoGroup = { depth: 0, startDoc: null, startSelection: null, changes: null };

/** The open undo group, if any. */
export const undoGroupField = StateField.define<UndoGroup>({
  create: () => CLOSED,
  update(group, tr) {
    let next = group;
    if (next.depth > 0 && tr.docChanged) next = { ...next, changes: next.changes!.compose(tr.changes) };
    for (const e of tr.effects) {
      if (e.is(beginGroup)) {
        next = next.depth > 0 ? { ...next, depth: next.depth + 1 } : { depth: 1, startDoc: tr.state.doc, startSelection: tr.state.selection, changes: ChangeSet.empty(tr.state.doc.length) };
      } else if (e.is(endGroup) && next.depth > 0) {
        next = next.depth > 1 ? { ...next, depth: next.depth - 1 } : CLOSED;
      }
    }
    return next;
  },
});

/** Keeps transactions out of the history while a group is open. */
const outOfHistory = EditorState.transactionExtender.of((tr) =>
  tr.docChanged && (tr.startState.field(undoGroupField, false)?.depth ?? 0) > 0 ? { annotations: Transaction.addToHistory.of(false) } : null,
);

/** The extensions undo groups need (alongside the history). */
export const undoGroups = [undoGroupField, outOfHistory];

/** Open an undo group (nested groups join the outermost one). */
export function beginUndoGroup(): TransactionSpec {
  return { effects: beginGroup.of(null) };
}

/** Number of open undo groups. */
export function undoGroupDepth(state: EditorState): number {
  return state.field(undoGroupField, false)?.depth ?? 0;
}

/**
 * Transactions that close one group level (or all of them), to dispatch in order.
 * Closing the outermost group also reverts its changes and reapplies them as one undo step.
 */
export function endUndoGroup(state: EditorState, all = false): TransactionSpec[] {
  const group = state.field(undoGroupField, false);
  if (!group || group.depth === 0) return [];
  const levels = all ? group.depth : 1;
  const close: TransactionSpec = { effects: Array.from({ length: levels }, () => endGroup.of(null)) };
  if (group.depth > levels || !group.changes || group.changes.empty) return [close];
  return [
    close,
    {
      changes: group.changes.invert(group.startDoc!),
      selection: group.startSelection!,
      annotations: [Transaction.addToHistory.of(false), undoGroupReplay.of(true)],
    },
    {
      changes: group.changes,
      selection: state.selection,
      annotations: [isolateHistory.of("full"), undoGroupReplay.of(true)],
    },
  ];
}
