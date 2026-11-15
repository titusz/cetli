/**
 * Misspelling marks (wavy underlines) set by the app's spell checker and kept
 * in place through edits until the next check.
 */

import { EditorState, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

const misspelledMark = Decoration.mark({ class: "cm-tp-misspelled" });

/** Replace the misspelling marks with these document ranges [from, to). */
export const setMisspellings = StateEffect.define<[number, number][]>();

export const spellingField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setMisspellings)) {
        const ranges: Range<Decoration>[] = e.value.filter(([f, t]) => t > f && t <= tr.state.doc.length).map(([f, t]) => misspelledMark.range(f, t));
        next = Decoration.set(ranges, true);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The misspelled document range containing `pos`, if any. */
export function misspellingAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  state.field(spellingField, false)?.between(pos, pos, (from, to) => {
    hit = { from, to };
  });
  return hit;
}
