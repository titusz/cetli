/**
 * Task/project gutter: a checkbox for tasks (click toggles @done), a fold
 * arrow for projects (click folds/unfolds), and on other lines a click turns
 * the line into a task, as in TodoPaper's margin.
 */

import { EditorState } from "@codemirror/state";
import { BlockInfo, EditorView, GutterMarker, gutter } from "@codemirror/view";
import { outlineField } from "./model";
import { isFolded, setFold } from "./visibility";
import { makeTasks, toggleDoneLines } from "./commands";

class IconMarker extends GutterMarker {
  constructor(readonly kind: "open" | "done" | "expanded" | "folded", readonly sub = false) {
    super();
  }
  eq(other: IconMarker) {
    return other.kind === this.kind && other.sub === this.sub;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-tp-gutter-icon cm-tp-gutter-${this.kind}${this.sub ? " cm-tp-gutter-sub" : ""}`;
    return el;
  }
}

const markers = {
  open: new IconMarker("open"),
  done: new IconMarker("done"),
  expanded: new IconMarker("expanded"),
  folded: new IconMarker("folded"),
  expandedSub: new IconMarker("expanded", true),
  foldedSub: new IconMarker("folded", true),
};

/** The document line (1-based) a gutter text block starts with (hidden lines never start one). */
export function blockLine(state: EditorState, block: BlockInfo): number {
  return state.doc.lineAt(block.from).number;
}

/** Choose the marker for a document line. */
function markerFor(state: EditorState, lineNumber: number): GutterMarker | null {
  const info = state.field(outlineField).infos[lineNumber - 1];
  if (!info) return null;
  if (info.type === "task") return info.done ? markers.done : markers.open;
  if (info.type !== "project") return null;
  const folded = isFolded(state, lineNumber - 1);
  if (info.level > 0) return folded ? markers.foldedSub : markers.expandedSub;
  return folded ? markers.folded : markers.expanded;
}

/** Handle a click in the gutter on a document line. */
function clickLine(view: EditorView, lineNumber: number): void {
  const state = view.state;
  const info = state.field(outlineField).infos[lineNumber - 1];
  const line = state.doc.line(lineNumber);
  if (info.type === "project") {
    view.dispatch({ effects: setFold.of({ pos: line.from, folded: !isFolded(state, lineNumber - 1) }) });
  } else if (info.type === "task") {
    view.dispatch(toggleDoneLines(state, [lineNumber]));
  } else {
    view.dispatch(makeTasks(state, [lineNumber]));
  }
}

export const taskGutter = gutter({
  class: "cm-tp-gutter",
  lineMarker(view, block) {
    return markerFor(view.state, blockLine(view.state, block));
  },
  lineMarkerChange: (update) => update.docChanged || update.transactions.some((tr) => tr.effects.length > 0),
  initialSpacer: () => markers.open,
  domEventHandlers: {
    mousedown(view, block, event) {
      if ((event as MouseEvent).button !== 0) return false;
      clickLine(view, blockLine(view.state, block));
      event.preventDefault();
      return true;
    },
  },
});
