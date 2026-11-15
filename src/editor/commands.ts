/**
 * TodoPaper editing commands.
 *
 * Each command is a pure function from an EditorState to a TransactionSpec
 * (or null when it does not apply), so they can be unit-tested without a
 * browser. Thin wrappers that dispatch them live in `keymap.ts`.
 */

import { ChangeSpec, EditorSelection, EditorState, Line, StateEffect, TransactionSpec } from "@codemirror/state";
import { Tag, findTags, hasDoneTag, indentEnd, parseLine, tagText } from "../core/parser";
import { Outline, blockEnd, lastContentLine } from "../core/outline";
import { strftime } from "../core/dates";
import { getConfig } from "./config";
import { outlineField } from "./model";
import { foldedPositions, isFolded, isLineHidden, setFold, visibilityField } from "./visibility";

// ---------------------------------------------------------------- helpers

/** True if a 1-based line is hidden (safe when the visibility field is absent). */
function hidden(state: EditorState, n: number): boolean {
  return state.field(visibilityField, false) ? isLineHidden(state, n) : false;
}

/** Unique visible line numbers (1-based) touched by the selection, sorted. */
export function selectedLines(state: EditorState): number[] {
  const set = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    if (r.to > r.from && state.doc.lineAt(r.to).from === r.to && last > first) last--;
    for (let n = first; n <= last; n++) if (!hidden(state, n)) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Leading whitespace of a line. */
function indentOf(text: string): string {
  return text.slice(0, indentEnd(text));
}

/** Today's date formatted with the configured date format. */
export function today(state: EditorState, now: Date = new Date()): string {
  return strftime(getConfig(state).dateFormat, now);
}

/** Change removing a tag and its surrounding whitespace from a line. */
function removeTagChange(line: Line, tag: Tag): ChangeSpec {
  const text = line.text;
  let from = tag.from;
  let to = tag.to;
  while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from--;
  if (from <= indentEnd(text)) {
    from = tag.from;
    while (to < text.length && text[to] === " ") to++;
  }
  return { from: line.from + from, to: line.from + to };
}

/** Change appending a tag to the end of a line. */
function appendTagChange(line: Line, tag: string): ChangeSpec {
  const sep = line.text.length === 0 || /\s$/.test(line.text) ? "" : " ";
  return { from: line.to, insert: sep + tag };
}

/** Text of lines first..last (1-based, inclusive) joined by newlines. */
function linesText(state: EditorState, first: number, last: number): string {
  return state.sliceDoc(state.doc.line(first).from, state.doc.line(last).to);
}

/** Change deleting a whole line including one adjacent line break. */
function deleteLineChange(state: EditorState, n: number): ChangeSpec {
  const line = state.doc.line(n);
  if (n < state.doc.lines) return { from: line.from, to: line.to + 1 };
  return { from: Math.max(0, line.from - 1), to: line.to };
}

/**
 * The line TodoPaper's findProject picked for a project name: the first line
 * containing "name:" (case-insensitive), or -1. Usually the project line.
 */
export function findProjectLine(state: EditorState, name: string): number {
  const needle = name.trim().toLowerCase() + ":";
  for (let n = 1; n <= state.doc.lines; n++) if (state.doc.line(n).text.toLowerCase().includes(needle)) return n - 1;
  return -1;
}

/** Fold-removal effect when inserting below a folded project line (so new lines stay visible). */
function unfoldIfFolded(state: EditorState, lineIndex: number): StateEffect<unknown>[] {
  if (!state.field(visibilityField, false) || !isFolded(state, lineIndex)) return [];
  return [setFold.of({ pos: state.doc.line(lineIndex + 1).from, folded: false })];
}

// ---------------------------------------------------------------- tags

/** Toggle @done on the given lines: remove it where present, add it (with date) elsewhere. */
export function toggleDoneLines(state: EditorState, lines: number[], now: Date = new Date()): TransactionSpec {
  const cfg = getConfig(state);
  const doneTag = cfg.autoTagDoneDate ? tagText("done", today(state, now)) : "@done";
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    if (!line.text.trim()) continue;
    const existing = findTags(line.text).find((t) => t.name.toLowerCase() === "done");
    changes.push(existing ? removeTagChange(line, existing) : appendTagChange(line, doneTag));
  }
  return { changes, userEvent: "input.done", scrollIntoView: false };
}

/**
 * Toggle an exact tag (name and value) on the given lines, as TodoPaper does:
 * lines carrying it lose it, other lines get it appended.
 */
export function toggleTagLines(state: EditorState, lines: number[], name: string, value: string | null = null): TransactionSpec {
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    if (!line.text.trim()) continue;
    const existing = findTags(line.text).find((t) => t.name.toLowerCase() === name.toLowerCase() && (t.value ?? null) === value);
    changes.push(existing ? removeTagChange(line, existing) : appendTagChange(line, tagText(name, value)));
  }
  return { changes, userEvent: "input.tag", scrollIntoView: false };
}

/** Add a tag (e.g. "@work") to lines that do not have it yet. */
export function addTagLines(state: EditorState, lines: number[], tag: string): TransactionSpec {
  const name = tag.replace(/^@/, "").replace(/\(.*$/, "");
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    if (!line.text.trim()) continue;
    if (findTags(line.text).some((t) => t.name.toLowerCase() === name.toLowerCase())) continue;
    changes.push(appendTagChange(line, tag.startsWith("@") ? tag : "@" + tag));
  }
  return { changes, userEvent: "input.tag" };
}

/** Find the tag covering a document position, if any. */
export function tagAt(state: EditorState, pos: number): { line: Line; tag: Tag } | null {
  const line = state.doc.lineAt(pos);
  const tag = findTags(line.text).find((t) => pos >= line.from + t.from && pos <= line.from + t.to);
  return tag ? { line, tag } : null;
}

/** Remove the tag at a document position. */
export function removeTagAt(state: EditorState, pos: number): TransactionSpec | null {
  const hit = tagAt(state, pos);
  return hit ? { changes: removeTagChange(hit.line, hit.tag), userEvent: "delete.tag" } : null;
}

// ---------------------------------------------------------------- creating items

/** Turn the given lines into tasks by prefixing "- " (projects and tasks are left alone). */
export function makeTasks(state: EditorState, lines: number[]): TransactionSpec {
  const changes: ChangeSpec[] = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    const info = parseLine(line.text);
    if (info.type === "task" || info.type === "project") continue;
    changes.push({ from: line.from + info.indentEnd, insert: "- " });
  }
  const spec: TransactionSpec = { changes, userEvent: "input.task" };
  if (lines.length === 1 && changes.length === 1) {
    const line = state.doc.line(lines[0]);
    const insertAt = line.from + indentEnd(line.text);
    const head = state.selection.main.head;
    if (head <= insertAt) spec.selection = EditorSelection.cursor(insertAt + 2);
  }
  return spec;
}

/**
 * New task (Ctrl+T): on a single project or task line insert a fresh task
 * below it; otherwise turn the selected lines into tasks.
 */
export function newTask(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  if (lines.length === 1) {
    const outline = state.field(outlineField);
    const idx = lines[0] - 1;
    const info = outline.infos[idx];
    if (info.type === "project" || info.type === "task") {
      const line = state.doc.line(lines[0]);
      const indent = indentOf(line.text);
      const insert = "\n" + indent + "- ";
      return {
        changes: { from: line.to, insert },
        selection: EditorSelection.cursor(line.to + insert.length),
        effects: unfoldIfFolded(state, idx),
        userEvent: "input.task",
        scrollIntoView: true,
      };
    }
  }
  return makeTasks(state, lines);
}

export const NEW_PROJECT_TEXT = "New Project";

/** New project (Ctrl+P): insert "New Project:" above the current line and select its name. */
export function newProject(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const indent = indentOf(line.text);
  const insert = `${indent}${NEW_PROJECT_TEXT}:\n`;
  const start = line.from + indent.length;
  return {
    changes: { from: line.from, insert },
    selection: EditorSelection.range(start, start + NEW_PROJECT_TEXT.length),
    userEvent: "input.project",
    scrollIntoView: true,
  };
}

/** New tag (Ctrl+G): insert "@tag" at the cursor (spaced from neighbours) and select "tag". */
export function newTag(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const before = from > 0 ? state.sliceDoc(from - 1, from) : "";
  const after = state.sliceDoc(to, to + 1);
  const lead = before && !/\s/.test(before) ? " " : "";
  const trail = after && !/\s/.test(after) ? " " : "";
  const insert = `${lead}@tag${trail}`;
  const start = from + lead.length + 1;
  return {
    changes: { from, to, insert },
    selection: EditorSelection.range(start, start + 3),
    userEvent: "input.tag",
  };
}

/** Wrap each non-empty selection in *bold* markers (Ctrl+B). */
export function boldSelection(state: EditorState): TransactionSpec | null {
  const ranges = state.selection.ranges.filter((r) => !r.empty);
  if (!ranges.length) return null;
  return state.changeByRange((r) => {
    if (r.empty) return { range: r };
    return {
      changes: [{ from: r.from, insert: "*" }, { from: r.to, insert: "*" }],
      range: EditorSelection.range(r.from, r.to + 2),
    };
  });
}

// ---------------------------------------------------------------- Enter key

export interface EnterOptions {
  shift?: boolean;
  ctrl?: boolean;
}

/**
 * TodoPaper's Enter key:
 * - project line: at the end (or with Shift) start a new task below (Ctrl: plain line)
 * - empty task "- ": outdent it, or clear it at top level
 * - task with Shift: new task below regardless of the cursor (Ctrl: plain line)
 * - task, cursor at its start: open a line above
 * - task, cursor in the middle or end: split into a new task
 * - anything else: newline keeping the indentation
 */
export function enter(state: EditorState, opts: EnterOptions = {}): TransactionSpec {
  const cfg = getConfig(state);
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  const text = line.text;
  const indent = cfg.autoIndent ? indentOf(text) : "";
  const info = parseLine(text);
  const pos = sel.head;
  const startPos = line.from + indentEnd(text);
  const atEnd = pos === line.to;
  const insertAt = (at: number, insert: string, replaceTo = at): TransactionSpec => ({
    changes: { from: at, to: replaceTo, insert },
    selection: EditorSelection.cursor(at + insert.length),
    userEvent: "input",
    scrollIntoView: true,
  });

  if (!sel.empty) return insertAt(sel.from, "\n" + indent, sel.to);

  if (info.type === "project") {
    if (atEnd || opts.shift) {
      const spec = insertAt(line.to, "\n" + indent + (opts.ctrl ? "" : "- "));
      spec.effects = unfoldIfFolded(state, line.number - 1);
      return spec;
    }
    return insertAt(pos, "\n" + indent);
  }

  if (info.type === "task") {
    if (text.trim() === "-") {
      if (info.level > 0) {
        const cut = text[0] === "\t" ? 1 : Math.min(4, indentEnd(text));
        return { changes: { from: line.from, to: line.from + cut }, userEvent: "input" };
      }
      return insertAt(line.from, "", line.to);
    }
    if (opts.shift) return insertAt(line.to, "\n" + indent + (opts.ctrl ? "" : "- "));
    if (pos <= startPos) {
      return {
        changes: { from: startPos, insert: "\n" + indent },
        selection: EditorSelection.cursor(startPos + 1 + indent.length),
        userEvent: "input",
        scrollIntoView: true,
      };
    }
    return insertAt(pos, "\n" + indent + "- ");
  }

  return insertAt(pos, "\n" + indent);
}

// ---------------------------------------------------------------- selection helpers

/** Select the text of the current line (Alt+S). */
export function selectLine(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  return { selection: EditorSelection.range(line.from, line.to) };
}

/** Select the current line with all its children (Alt+H). */
export function selectHierarchy(state: EditorState): TransactionSpec {
  const outline = state.field(outlineField);
  const line = state.doc.lineAt(state.selection.main.head);
  const last = blockEnd(outline, line.number - 1) + 1;
  return { selection: EditorSelection.range(line.from, state.doc.line(last).to) };
}

/** Range of the current line's text (Cut Line cuts it and leaves the empty line, as TodoPaper). */
export function lineTextRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

// ---------------------------------------------------------------- moving lines

/** Extend a block's last line over the hidden children of folded projects inside it. */
function extendOverFolds(state: EditorState, outline: Outline, first: number, last: number): number {
  let end = last;
  for (let n = first; n <= end; n++) {
    if (outline.infos[n - 1].type === "project" && state.field(visibilityField, false) && isFolded(state, n - 1)) {
      end = Math.max(end, outline.end[n - 1] + 1);
    }
  }
  return end;
}

/** The unit (first..last, 1-based) a block swaps with when moving in `dir`. */
function adjacentUnit(state: EditorState, outline: Outline, first: number, last: number, dir: -1 | 1, group: boolean): [number, number] | null {
  const root = outline.infos[first - 1];
  const sameKind = (n: number) => {
    const info = outline.infos[n - 1];
    return info.type !== "blank" && (info.type === "project") === (root.type === "project") && info.level === root.level;
  };
  if (dir === 1) {
    let n = last + 1;
    while (n <= state.doc.lines && hidden(state, n)) n++;
    if (n > state.doc.lines) return null;
    const end = group && sameKind(n) ? blockEnd(outline, n - 1) + 1 : extendOverFolds(state, outline, n, n);
    return [n, Math.max(n, end)];
  }
  let n = first - 1;
  while (n >= 1 && hidden(state, n)) n--;
  if (n < 1) return null;
  if (group) {
    for (let c = n; c >= 1; c--) {
      if (hidden(state, c)) continue;
      const end = blockEnd(outline, c - 1) + 1;
      if (end >= first) break; // reached an ancestor
      if (sameKind(c) && end >= n) return [c, first - 1];
    }
  }
  // hidden lines between the previous visible line and the block stay below it
  return [n, first - 1];
}

/**
 * Move the selected lines up or down past the adjacent visible line.
 * With `group`, a single selected line moves together with its children and
 * swaps with its sibling block.
 */
export function moveLines(state: EditorState, dir: -1 | 1, group = false): TransactionSpec | null {
  const outline = state.field(outlineField);
  const lines = selectedLines(state);
  if (!lines.length) return null;
  const first = lines[0];
  let last = lines[lines.length - 1];
  if (group && lines.length === 1) last = blockEnd(outline, first - 1) + 1;
  last = extendOverFolds(state, outline, first, last);
  const unit = adjacentUnit(state, outline, first, last, dir, group);
  if (!unit) return null;
  const doc = state.doc;
  const block = linesText(state, first, last);
  const blockFrom = doc.line(first).from;
  let changes: ChangeSpec[];
  let shift: number;
  if (dir === -1) {
    const target = doc.line(unit[0]).from;
    changes = [{ from: target, insert: block + "\n" }, deleteLineRange(state, first, last)];
    shift = target - blockFrom;
  } else {
    const unitLine = doc.line(unit[1]);
    changes = [deleteLineRange(state, first, last), { from: unitLine.to, insert: "\n" + block }];
    shift = unitLine.to - doc.line(last).to;
  }
  const selection = EditorSelection.create(
    state.selection.ranges.map((r) => EditorSelection.range(r.anchor + shift, r.head + shift)),
    state.selection.mainIndex,
  );
  const effects = movedFoldEffects(state, first, last, shift);
  return { changes, selection, effects, userEvent: "move.line", scrollIntoView: true };
}

/** Change deleting lines first..last (1-based) including one adjacent line break. */
function deleteLineRange(state: EditorState, first: number, last: number): ChangeSpec {
  const from = state.doc.line(first).from;
  const to = state.doc.line(last).to;
  if (last < state.doc.lines) return { from, to: to + 1 };
  return { from: Math.max(0, from - 1), to };
}

/** Effects re-creating folds of projects that moved with a block. */
function movedFoldEffects(state: EditorState, first: number, last: number, shift: number): StateEffect<unknown>[] {
  if (!state.field(visibilityField, false)) return [];
  const from = state.doc.line(first).from;
  const to = state.doc.line(last).to;
  return foldedPositions(state)
    .filter((p) => p >= from && p <= to)
    .map((p) => setFold.of({ pos: p + shift, folded: true }));
}

/** Move the given lines to the top of a project (context menu "Move to..."). */
export function moveLinesToProject(state: EditorState, lines: number[], project: string): TransactionSpec | null {
  const target = findProjectLine(state, project);
  if (target < 0) return null;
  const moving = lines.filter((n) => n - 1 !== target && state.doc.line(n).text.trim().length > 0);
  if (!moving.length) return null;
  const header = state.doc.line(target + 1);
  const texts = moving.map((n) => state.doc.line(n).text);
  const changes: ChangeSpec[] = moving.map((n) => deleteLineChange(state, n));
  changes.push({ from: header.to, insert: "\n" + texts.join("\n") });
  return { changes, effects: unfoldIfFolded(state, target), userEvent: "move.line" };
}

// ---------------------------------------------------------------- archive

/** Lines that may be archived: not blank, not projects, not archived, not directly in the archive project. */
function archivable(state: EditorState, outline: Outline, n: number): boolean {
  const info = outline.infos[n - 1];
  if (info.type === "blank" || info.type === "project") return false;
  if (info.tags.some((t) => t.name.toLowerCase() === "archive")) return false;
  const parent = outline.parent[n - 1];
  return parent < 0 || outline.infos[parent].name !== getConfig(state).archiveProject;
}

/**
 * Move lines to the archive project as "<line> @archive(Project_Name)".
 * They go directly below the archive header in document order; the archive
 * project is created at the end of the document when missing.
 */
export function archiveLines(state: EditorState, lines: number[]): TransactionSpec | null {
  const outline = state.field(outlineField);
  const name = getConfig(state).archiveProject;
  const eligible = lines.filter((n) => archivable(state, outline, n));
  if (!eligible.length) return null;
  const texts = eligible.map((n) => {
    const parent = outline.parent[n - 1];
    const suffix = parent >= 0 ? `(${outline.infos[parent].name.replace(/ /g, "_")})` : "";
    return `${state.doc.line(n).text.trimEnd()} @archive${suffix}`;
  });
  const changes: ChangeSpec[] = eligible.map((n) => deleteLineChange(state, n));
  const archive = findProjectLine(state, name);
  if (archive >= 0) {
    changes.push({ from: state.doc.line(archive + 1).to, insert: "\n" + texts.join("\n") });
  } else {
    const lastLine = state.doc.line(state.doc.lines);
    const lead = lastLine.text.trim() ? "\n\n" : lastLine.number > 1 ? "\n" : "";
    changes.push({ from: state.doc.length, insert: `${lead}${name}:\n${texts.join("\n")}` });
  }
  return { changes, userEvent: "delete.archive" };
}

/** Archive all lines carrying @done (any case, as TodoPaper) outside the archive project. */
export function archiveDone(state: EditorState): TransactionSpec | null {
  const lines: number[] = [];
  for (let n = 1; n <= state.doc.lines; n++) if (hasDoneTag(state.doc.line(n).text)) lines.push(n);
  return archiveLines(state, lines);
}

// ---------------------------------------------------------------- quick log

/**
 * Append text (possibly several lines) at the end of a project, creating the
 * project at the top of the document when it does not exist.
 */
export function addToProject(state: EditorState, text: string, project: string): TransactionSpec | null {
  const items = text.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  if (!items.length) return null;
  const name = project.trim() || getConfig(state).inbox;
  const outline = state.field(outlineField);
  const target = findProjectLine(state, name);
  if (target < 0) {
    return { changes: { from: 0, insert: `${name}:\n${items.join("\n")}\n` }, userEvent: "input.log" };
  }
  // like TodoPaper: after the project's last child, with the project's own indentation
  const indent = indentOf(state.doc.line(target + 1).text);
  const lastIndex = outline.infos[target].type === "project" ? lastContentLine(outline, target) : target;
  const last = state.doc.line(lastIndex + 1);
  const insert = items.map((l) => "\n" + indent + l.replace(/^\s+/, "")).join("");
  return { changes: { from: last.to, insert }, userEvent: "input.log" };
}

// ---------------------------------------------------------------- navigation and folding

/** Move the cursor to the previous (-1) or next (+1) visible project line. */
export function jumpToProject(state: EditorState, dir: -1 | 1): TransactionSpec | null {
  const outline = state.field(outlineField);
  const current = state.doc.lineAt(state.selection.main.head).number;
  for (let n = current + dir; n >= 1 && n <= state.doc.lines; n += dir) {
    if (outline.infos[n - 1].type === "project" && !hidden(state, n)) {
      return { selection: EditorSelection.cursor(state.doc.line(n).from), scrollIntoView: true };
    }
  }
  return null;
}

/** Toggle the fold of the project at (or containing) the cursor line. */
export function toggleCurrentFold(state: EditorState): TransactionSpec | null {
  const outline = state.field(outlineField);
  let idx = state.doc.lineAt(state.selection.main.head).number - 1;
  if (outline.infos[idx].type !== "project") idx = outline.parent[idx];
  if (idx < 0 || outline.end[idx] <= idx) return null;
  const pos = state.doc.line(idx + 1).from;
  const folded = !isFolded(state, idx);
  return { effects: setFold.of({ pos, folded }), selection: folded ? EditorSelection.cursor(pos) : undefined };
}

/** Line start positions of all projects that have children. */
export function foldableProjects(state: EditorState): number[] {
  const outline = state.field(outlineField);
  const out: number[] = [];
  outline.infos.forEach((info, i) => {
    if (info.type === "project" && outline.end[i] > i) out.push(state.doc.line(i + 1).from);
  });
  return out;
}
