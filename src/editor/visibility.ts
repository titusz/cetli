/**
 * Line visibility: search filtering and project folding.
 *
 * Both features hide whole lines, so they share one state field that turns
 * the union of "filtered out" and "inside a folded project" lines into
 * replace decorations.
 *
 * The filter result is stored as hidden-line marks that are *mapped* through
 * later edits instead of recomputed. Lines you type or change in a filtered
 * view therefore stay visible until the filter is refreshed (TodoPaper
 * behaviour). The `stale` flag tells the UI to offer a refresh.
 */

import { EditorState, Range, RangeSet, RangeSetBuilder, RangeValue, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { Outline } from "../core/outline";
import { isEmptyQuery, parseQuery, visibleLines } from "../core/search";
import { docLines, outlineField } from "./model";

/** Marks a line hidden by the filter, as a point at the line start. */
class HiddenMark extends RangeValue {
  startSide = 1;
  endSide = 1;
  point = true;
}
const hiddenMark = new HiddenMark();

/** Marks a folded project by a point at the start of its line. */
class FoldMark extends RangeValue {
  startSide = 1;
  endSide = 1;
  point = true;
}
const foldMark = new FoldMark();

export interface Visibility {
  query: string;
  filter: RangeSet<HiddenMark>;
  folds: RangeSet<FoldMark>;
  /** The document changed since the filter was computed. */
  stale: boolean;
  /** Per line (0-based): 1 if hidden. */
  hidden: Uint8Array;
  deco: DecorationSet;
}

export const setQuery = StateEffect.define<string>();
export const refreshFilter = StateEffect.define<null>();
/** Fold (true) or unfold (false) the project starting at the given line start position. */
export const setFold = StateEffect.define<{ pos: number; folded: boolean }>({
  map: (v, changes) => ({ pos: changes.mapPos(v.pos, 1), folded: v.folded }),
});
/** Replace all folds with folds at the given line start positions. */
export const setAllFolds = StateEffect.define<number[]>();

class FoldWidget extends WidgetType {
  constructor(readonly header: number) {
    super();
  }
  eq(other: FoldWidget) {
    return other.header === this.header;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-tp-fold-placeholder";
    el.textContent = "…";
    el.title = "Unfold project";
    el.onmousedown = (e) => {
      e.preventDefault();
      const pos = view.state.doc.line(this.header + 1).from;
      view.dispatch({ effects: setFold.of({ pos, folded: false }) });
    };
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const hiddenInline = Decoration.replace({});
const hiddenBlock = Decoration.replace({ block: true });

/** Compute filter hidden ranges for a query (empty set when the query is empty). */
function computeFilter(doc: Text, outline: Outline, query: string): RangeSet<HiddenMark> {
  const parsed = parseQuery(query);
  if (isEmptyQuery(parsed)) return RangeSet.empty;
  const visible = visibleLines(outline, docLines(doc), parsed);
  const builder = new RangeSetBuilder<HiddenMark>();
  for (let i = 0; i < visible.length; i++) {
    if (!visible[i]) {
      const pos = doc.line(i + 1).from;
      builder.add(pos, pos, hiddenMark);
    }
  }
  return builder.finish();
}

/** Flag lines whose start carries a hidden mark (marks that drifted mid-line are ignored). */
function markFilter(doc: Text, filter: RangeSet<HiddenMark>, hidden: Uint8Array) {
  filter.between(0, doc.length, (from) => {
    const line = doc.lineAt(from);
    if (line.from === from) hidden[line.number - 1] = 1;
  });
}

/** Flag lines hidden by folded projects; returns the set of folded header lines with hidden children. */
function markFolds(doc: Text, outline: Outline, folds: RangeSet<FoldMark>, hidden: Uint8Array): Set<number> {
  const headers = new Set<number>();
  folds.between(0, doc.length, (from) => {
    const idx = doc.lineAt(from).number - 1;
    if (outline.infos[idx]?.type !== "project" || outline.end[idx] <= idx) return;
    hidden.fill(1, idx + 1, outline.end[idx] + 1);
    headers.add(idx);
  });
  return headers;
}

/** Turn runs of hidden lines into replace decorations. */
function buildDecorations(doc: Text, hidden: Uint8Array, headers: Set<number>): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const n = hidden.length;
  let i = 0;
  while (i < n) {
    if (!hidden[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && hidden[j + 1]) j++;
    const to = doc.line(j + 1).to;
    if (i === 0) {
      // nothing visible above: hide whole lines as a zero-height block so the
      // first visible line keeps its own line element (styling and gutter)
      if (to > 0) ranges.push(hiddenBlock.range(0, to));
    } else {
      // append the hidden run (with its leading line break) to the visible line above
      const from = doc.line(i).to;
      const folded = headers.has(i - 1) && !hidden[i - 1];
      const deco = folded ? Decoration.replace({ widget: new FoldWidget(i - 1) }) : hiddenInline;
      ranges.push(deco.range(from, to));
    }
    i = j + 1;
  }
  return Decoration.set(ranges, true);
}

/** Recompute hidden flags and decorations from filter and folds. */
function compute(state: EditorState, query: string, filter: RangeSet<HiddenMark>, folds: RangeSet<FoldMark>, stale: boolean): Visibility {
  const doc = state.doc;
  const outline = state.field(outlineField);
  const hidden = new Uint8Array(doc.lines);
  markFilter(doc, filter, hidden);
  const headers = markFolds(doc, outline, folds, hidden);
  return { query, filter, folds, stale, hidden, deco: buildDecorations(doc, hidden, headers) };
}

/** Normalize fold positions to line starts, dropping duplicates. */
function foldSet(doc: Text, positions: number[]): RangeSet<FoldMark> {
  const starts = [...new Set(positions.map((p) => doc.lineAt(Math.min(p, doc.length)).from))].sort((a, b) => a - b);
  return RangeSet.of(starts.map((p) => foldMark.range(p)));
}

/** List fold positions (line starts) of a fold set. */
function foldPositions(folds: RangeSet<FoldMark>, doc: Text): number[] {
  const out: number[] = [];
  folds.between(0, doc.length, (from) => {
    out.push(from);
  });
  return out;
}

export const visibilityField = StateField.define<Visibility>({
  create(state) {
    return compute(state, "", RangeSet.empty, RangeSet.empty, false);
  },
  update(vis, tr) {
    let { query, filter, folds, stale } = vis;
    let refilter = false;
    let changed = tr.docChanged;
    if (tr.docChanged) {
      filter = filter.map(tr.changes);
      folds = foldSet(tr.state.doc, foldPositions(folds.map(tr.changes), tr.state.doc));
      stale = stale || query.trim().length > 0;
    }
    for (const e of tr.effects) {
      if (e.is(setQuery)) {
        query = e.value;
        refilter = true;
      } else if (e.is(refreshFilter)) {
        refilter = true;
      } else if (e.is(setFold)) {
        const positions = foldPositions(folds, tr.state.doc).filter((p) => p !== tr.state.doc.lineAt(e.value.pos).from);
        if (e.value.folded) positions.push(e.value.pos);
        folds = foldSet(tr.state.doc, positions);
        changed = true;
      } else if (e.is(setAllFolds)) {
        folds = foldSet(tr.state.doc, e.value);
        changed = true;
      }
    }
    if (refilter) {
      filter = computeFilter(tr.state.doc, tr.state.field(outlineField), query);
      stale = false;
      changed = true;
    }
    return changed ? compute(tr.state, query, filter, folds, stale) : vis;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).deco),
    // the margin shows that a search is active (TodoPaper colours it)
    EditorView.editorAttributes.from(f, (v) => ({ class: v.query.trim() ? "cm-tp-filtered" : "" })),
  ],
});

/** Get the visibility state. */
export function getVisibility(state: EditorState): Visibility {
  return state.field(visibilityField);
}

/** True if the 1-based document line is hidden. */
export function isLineHidden(state: EditorState, lineNumber: number): boolean {
  return getVisibility(state).hidden[lineNumber - 1] === 1;
}

/** True if the project at 0-based line index is folded. */
export function isFolded(state: EditorState, lineIndex: number): boolean {
  const pos = state.doc.line(lineIndex + 1).from;
  let found = false;
  getVisibility(state).folds.between(pos, pos, (from) => {
    if (from === pos) found = true;
  });
  return found;
}

/** Line start positions of all folded projects. */
export function foldedPositions(state: EditorState): number[] {
  return foldPositions(getVisibility(state).folds, state.doc);
}
