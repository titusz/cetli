/** Tests for search filtering and folding (hidden lines and their decorations). */

import { describe, expect, test } from "vitest";
import { apply, mk } from "./helpers";
import { getVisibility, isFolded, refreshFilter, setAllFolds, setFold, setQuery } from "../../src/editor/visibility";

/** 1-based numbers of visible lines. */
function visible(state: ReturnType<typeof mk>): number[] {
  return Array.from(getVisibility(state).hidden).flatMap((h, i) => (h ? [] : [i + 1]));
}

/** Replaced (hidden) document ranges as text. */
function replaced(state: ReturnType<typeof mk>): string[] {
  const out: string[] = [];
  getVisibility(state).deco.between(0, state.doc.length, (from, to) => {
    out.push(state.sliceDoc(from, to));
  });
  return out;
}

const DOC = "Inbox:\n- a @today\n- b\nWork:\n- c @today\n- d";

describe("filter", () => {
  test("query hides non-matching lines", () => {
    let s = mk(DOC);
    s = apply(s, { effects: setQuery.of("@today") });
    expect(visible(s)).toEqual([1, 2, 4, 5]);
    expect(replaced(s)).toEqual(["\n- b", "\n- d"]);
  });

  test("hidden lines at the start of the document", () => {
    let s = mk("x\ny\nWork:\n- c @today");
    s = apply(s, { effects: setQuery.of("@today") });
    expect(visible(s)).toEqual([3, 4]);
    expect(replaced(s)).toEqual(["x\ny"]);
  });

  test("everything hidden", () => {
    let s = mk("a\nb");
    s = apply(s, { effects: setQuery.of("zzz") });
    expect(visible(s)).toEqual([]);
    expect(replaced(s)).toEqual(["a\nb"]);
  });

  test("clearing the query shows everything", () => {
    let s = mk(DOC);
    s = apply(s, { effects: setQuery.of("@today") });
    s = apply(s, { effects: setQuery.of("") });
    expect(visible(s)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(replaced(s)).toEqual([]);
  });

  test("edited lines stay visible until refresh, new lines are visible", () => {
    let s = mk(DOC);
    s = apply(s, { effects: setQuery.of("@today") });
    const line2 = s.doc.line(2);
    // remove the tag from line 2 and add a new line after it
    s = apply(s, { changes: [{ from: line2.from + 3, to: line2.to, insert: "" }, { from: line2.to, insert: "\n- new" }] });
    expect(s.doc.line(2).text).toBe("- a");
    expect(visible(s)).toEqual([1, 2, 3, 5, 6]);
    expect(getVisibility(s).stale).toBe(true);
    s = apply(s, { effects: refreshFilter.of(null) });
    expect(visible(s)).toEqual([5, 6]);
    expect(getVisibility(s).stale).toBe(false);
  });

  test("a hidden blank line survives edits elsewhere", () => {
    let s = mk("A:\n- x\n\nB:\n- x");
    s = apply(s, { effects: setQuery.of("x") });
    expect(visible(s)).toEqual([1, 2, 4, 5]);
    s = apply(s, { changes: { from: 0, insert: "Z" } });
    expect(visible(s)).toEqual([1, 2, 4, 5]);
  });
});

describe("folding", () => {
  test("folding hides the project's range and shows a placeholder", () => {
    let s = mk(DOC);
    s = apply(s, { effects: setFold.of({ pos: 0, folded: true }) });
    expect(isFolded(s, 0)).toBe(true);
    expect(visible(s)).toEqual([1, 4, 5, 6]);
    expect(replaced(s)).toEqual(["\n- a @today\n- b"]);
  });

  test("fold follows its project when lines are inserted above", () => {
    let s = mk(DOC);
    s = apply(s, { effects: setFold.of({ pos: s.doc.line(4).from, folded: true }) });
    s = apply(s, { changes: { from: 0, insert: "new line\n" } });
    expect(isFolded(s, 4)).toBe(true);
    expect(visible(s)).toEqual([1, 2, 3, 4, 5]);
  });

  test("typing at the start of a folded project keeps the fold", () => {
    let s = mk(DOC);
    s = apply(s, { effects: setFold.of({ pos: 0, folded: true }) });
    s = apply(s, { changes: { from: 0, insert: "My " } });
    expect(s.doc.line(1).text).toBe("My Inbox:");
    expect(isFolded(s, 0)).toBe(true);
  });

  test("fold and filter combine", () => {
    let s = mk(DOC);
    s = apply(s, { effects: [setQuery.of("@today"), setFold.of({ pos: 0, folded: true })] });
    expect(visible(s)).toEqual([1, 4, 5]);
  });

  test("fold all / unfold all; empty projects are not folded", () => {
    let s = mk("A:\n- a\nB:\nC:\n- c");
    s = apply(s, { effects: setAllFolds.of([0, s.doc.line(3).from, s.doc.line(4).from]) });
    expect(visible(s)).toEqual([1, 3, 4]);
    s = apply(s, { effects: setAllFolds.of([]) });
    expect(visible(s)).toEqual([1, 2, 3, 4, 5]);
  });
});
