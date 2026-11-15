/**
 * Printing: renders the currently visible lines (respecting search and
 * folds) as static styled HTML and opens the system print dialog. The editor
 * only renders lines in the viewport, so it cannot be printed directly.
 */

import { EditorState } from "@codemirror/state";
import { getOutline } from "../editor/model";
import { getVisibility } from "../editor/visibility";

/** Escape text for HTML. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render one line with tag spans. */
function renderLine(text: string, tags: { from: number; to: number }[]): string {
  let out = "";
  let pos = 0;
  for (const t of tags) {
    out += esc(text.slice(pos, t.from)) + `<span class="cm-tp-tag">${esc(text.slice(t.from, t.to))}</span>`;
    pos = t.to;
  }
  return out + esc(text.slice(pos));
}

/** Print the visible part of the document. */
export function printDocument(state: EditorState, title: string, pageCss = ""): void {
  const outline = getOutline(state);
  const hidden = getVisibility(state).hidden;
  const rows: string[] = [];
  for (let i = 0; i < state.doc.lines; i++) {
    if (hidden[i]) continue;
    const info = outline.infos[i];
    const text = state.doc.line(i + 1).text;
    const classes = ["cm-line", `cm-tp-${info.type}`];
    if (info.type === "project") classes.push(info.level === 0 ? "cm-tp-project-top" : "cm-tp-project-sub");
    if (info.done) classes.push("cm-tp-done");
    const indent = text.slice(0, info.indentEnd);
    const body = renderLine(text.slice(info.indentEnd), info.tags.map((t) => ({ from: t.from - info.indentEnd, to: t.to - info.indentEnd })));
    rows.push(`<div class="${classes.join(" ")}">${esc(indent)}<span class="cm-tp-content">${body || "&nbsp;"}</span></div>`);
  }
  let area = document.getElementById("print-area");
  if (!area) {
    area = document.createElement("div");
    area.id = "print-area";
    document.body.appendChild(area);
  }
  area.innerHTML = `<style id="page-setup">${pageCss}</style><h1 class="print-title">${esc(title)}</h1><div class="cm-editor"><div class="cm-content">${rows.join("")}</div></div>`;
  window.print();
}
