/**
 * Tests for undo groups (Scintilla's BeginUndoAction / EndUndoAction used by
 * TodoPaper plugins): grouped changes undo and redo as one step, groups nest,
 * and the replay transactions are marked so tag hooks ignore them.
 */

import { EditorSelection, EditorState, StateEffect, Transaction, TransactionSpec } from "@codemirror/state";
import { history, isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import { describe, expect, test } from "vitest";
import { beginUndoGroup, endUndoGroup, undoGroupDepth, undoGroupReplay, undoGroups } from "../../src/editor/undogroup";
import { EditorHost, editorCall } from "../../src/app/pyeditor";
import { mk } from "./helpers";

/** An editor with history and undo groups; edits are isolated so each would be its own undo step. */
function editor(doc: string) {
  let state = mk(doc).update({ effects: StateEffect.appendConfig.of([history(), undoGroups]) }).state;
  const seen: Transaction[] = [];
  const dispatch = (...specs: TransactionSpec[]) => {
    const tr = state.update(...specs);
    seen.push(tr);
    state = tr.state;
  };
  const target = { get state() { return state; }, dispatch: (tr: Transaction) => (state = tr.state) };
  const edit = (from: number, insert: string) => dispatch({ changes: { from, insert }, annotations: isolateHistory.of("full") });
  const close = (all = false) => endUndoGroup(state, all).forEach((spec) => dispatch(spec));
  return { dispatch, edit, close, seen, target, text: () => state.doc.toString(), state: () => state };
}

describe("undo groups", () => {
  test("changes inside a group undo and redo as one step, restoring the selection", () => {
    const e = editor("one|");
    e.dispatch(beginUndoGroup());
    e.edit(3, " two");
    e.dispatch({ selection: EditorSelection.cursor(0) });
    e.edit(0, "zero ");
    expect(undoDepth(e.state())).toBe(0);
    e.close();
    expect(e.text()).toBe("zero one two");
    expect(undoDepth(e.state())).toBe(1);
    expect(undo(e.target)).toBe(true);
    expect(e.text()).toBe("one");
    expect(e.state().selection.main.head).toBe(3);
    expect(undo(e.target)).toBe(false);
    redo(e.target);
    expect(e.text()).toBe("zero one two");
  });

  test("without a group every isolated change is its own step", () => {
    const e = editor("a");
    e.edit(1, "b");
    e.edit(2, "c");
    expect(undoDepth(e.state())).toBe(2);
  });

  test("groups nest: only the outermost end makes the undo step", () => {
    const e = editor("a");
    e.dispatch(beginUndoGroup());
    e.dispatch(beginUndoGroup());
    e.edit(1, "b");
    e.close();
    expect(undoGroupDepth(e.state())).toBe(1);
    expect(undoDepth(e.state())).toBe(0);
    e.edit(2, "c");
    e.close();
    expect(undoGroupDepth(e.state())).toBe(0);
    expect(undoDepth(e.state())).toBe(1);
    undo(e.target);
    expect(e.text()).toBe("a");
  });

  test("closing all levels at once; empty groups add no undo step; ending without a group does nothing", () => {
    const e = editor("a");
    expect(endUndoGroup(e.state())).toEqual([]);
    e.dispatch(beginUndoGroup());
    e.close();
    expect(undoDepth(e.state())).toBe(0);
    e.dispatch(beginUndoGroup());
    e.dispatch(beginUndoGroup());
    e.edit(1, "b");
    e.close(true);
    expect([undoGroupDepth(e.state()), undoDepth(e.state()), e.text()]).toEqual([0, 1, "ab"]);
  });

  test("the replay transactions are marked (tag hooks skip them)", () => {
    const e = editor("a");
    e.dispatch(beginUndoGroup());
    e.edit(1, " @today");
    e.close();
    const marked = e.seen.filter((tr) => tr.annotation(undoGroupReplay));
    expect(marked.map((tr) => tr.newDoc.toString())).toEqual(["a", "a @today"]);
  });
});

test("a TodoPaper plugin's BeginUndoAction / EndUndoAction make its edits one undo step", () => {
  const e = editor("Home:\n- one");
  const h: EditorHost = {
    state: () => e.state(),
    dispatch: (spec) => e.dispatch(spec, { annotations: isolateHistory.of("full") }),
    eol: () => "\r\n",
    runAction: () => {},
    setSearch: () => {},
    save: async () => {},
    watchTag: () => {},
    unwatchTag: () => {},
  };
  editorCall(h, "BeginUndoAction");
  editorCall(h, "InsertText", [editorCall(h, "GetLineEndPosition", [1]), " @a"]);
  editorCall(h, "AddToProject", ["two", "Home"]);
  editorCall(h, "EndUndoAction");
  expect(e.text()).toBe("Home:\n- one @a\n- two");
  expect(undoDepth(e.state())).toBe(1);
  undo(e.target);
  expect(e.text()).toBe("Home:\n- one");
});

test("a state without undo groups ignores them", () => {
  const state = EditorState.create({ doc: "x" });
  expect([undoGroupDepth(state), endUndoGroup(state)]).toEqual([0, []]);
});
