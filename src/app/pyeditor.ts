/**
 * The editor object of TodoPaper's Python plugin API, answered by Cetli.
 *
 * Python plugins call methods of TodoPaper's editor control: Scintilla methods
 * (GetText, GetCurrentPos, InsertText, LineFromPosition, ...) and TodoPaper's
 * own (AddToProject, getSelectedLines, tagDone, Search, ...). The bridge sends
 * each call here; positions are Scintilla's UTF-8 byte offsets including line
 * endings and line numbers are 0-based, exactly as in TodoPaper.
 */

import { EditorSelection, EditorState, TransactionSpec } from "@codemirror/state";
import { redoDepth, undoDepth } from "@codemirror/commands";
import { byteLength, byteToPos, clampLine, lineStartByte, posToByte, utf8Length } from "../core/scintilla";
import { collectTags, listProjects } from "../core/outline";
import { indentEnd, indentLevel, projectName } from "../core/parser";
import { getConfig } from "../editor/config";
import { getOutline } from "../editor/model";
import { isLineHidden } from "../editor/visibility";
import * as cmd from "../editor/commands";
import { beginUndoGroup, endUndoGroup } from "../editor/undogroup";

/** What the plugin editor needs from Cetli. */
export interface EditorHost {
  state(): EditorState;
  dispatch(spec: TransactionSpec): void;
  /** Line ending of the document's file ("\r\n" or "\n"). */
  eol(): string;
  runAction(id: string): void;
  setSearch(query: string): void;
  save(): Promise<unknown>;
  watchTag(tag: string): void;
  unwatchTag(tag: string): void;
}

type Method = (h: EditorHost, ...args: any[]) => unknown;

/** TodoPaper editor commands that are Cetli actions. */
const ACTION_METHODS: Record<string, string> = {
  tagDone: "tagDone",
  tagDate: "tagDate",
  tagToday: "tagToday",
  insertTask: "newTask",
  insertProject: "newProject",
  insertTag: "newTag",
  ArchiveDoneTasks: "archiveDone",
  ArchiveCurrentLines: "archiveLines",
  ArchiveCurrentLine: "archiveLines",
  toggleDoneTasks: "hideDone",
  toggleCurrentProject: "toggleFold",
  ScrollToPrevProject: "prevProject",
  ScrollToNextProject: "nextProject",
  ZoomIn: "zoomIn",
  ZoomOut: "zoomOut",
  ZoomNormal: "zoomReset",
  CutLine: "cutLine",
  SearchReset: "resetSearch",
  SearchRefresh: "refreshSearch",
  Undo: "undo",
  Redo: "redo",
  OpenConsole: "console",
};

/** Parameter names of methods with optional parameters, for Python keyword arguments. */
const PARAMS: Record<string, string[]> = {
  AddToProject: ["itemText", "projectName", "makeTask"],
  insertLine: ["currentLine", "text", "before", "autoIndent"],
  MoveCurrentLineUp: ["group"],
  MoveCurrentLineDown: ["group"],
  ShowAllFolds: ["showFolds"],
  replaceLine: ["line", "with_"],
  InsertText: ["pos", "text"],
};

const doc = (h: EditorHost) => h.state().doc;
const main = (h: EditorHost) => h.state().selection.main;
const toPos = (h: EditorHost, byte: number) => byteToPos(doc(h), byte, h.eol());
const toByte = (h: EditorHost, pos: number) => posToByte(doc(h), pos, h.eol());
const line0 = (h: EditorHost, line: number) => doc(h).line(clampLine(doc(h), line) + 1);
const lineOf = (h: EditorHost, pos: number) => doc(h).lineAt(pos).number - 1;

/** Text with any line endings converted to the editor's "\n". */
function normalize(text: unknown): string {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}

/** A line's text with its line ending (none on the last line), like Scintilla's GetLine. */
function lineWithEol(h: EditorHost, line: number): string {
  const l = line0(h, line);
  return l.text + (l.number < doc(h).lines ? h.eol() : "");
}

/** Select from anchor to head (document positions) and scroll there. */
function select(h: EditorHost, anchor: number, head = anchor): null {
  h.dispatch({ selection: EditorSelection.single(anchor, head), scrollIntoView: true });
  return null;
}

/** Replace a range; with `caret`, put the cursor after the inserted text. */
function replace(h: EditorHost, from: number, to: number, text: unknown, caret = false): null {
  const insert = normalize(text);
  h.dispatch({ changes: { from, to, insert }, ...(caret ? { selection: EditorSelection.cursor(from + insert.length) } : {}) });
  return null;
}

/** Delete a line and its line ending (the last line is only emptied), like Scintilla's LineDelete. */
function deleteLine(h: EditorHost, line: number): null {
  const l = line0(h, line);
  const to = l.number < doc(h).lines ? doc(h).line(l.number + 1).from : l.to;
  return replace(h, l.from, to, "");
}

/** TodoPaper's insertLine: a line after (or before) `line`; returns the new line's number. */
function insertLine(h: EditorHost, line: number, text: unknown, before = false, autoIndent = true): number {
  const l = line0(h, line);
  const body = text == null ? "" : normalize(text);
  if (before) {
    replace(h, l.from, l.from, body + "\n");
    select(h, l.from);
    return l.number - 1;
  }
  const indent = autoIndent ? l.text.slice(0, indentEnd(l.text)) : "";
  const inserted = "\n" + (autoIndent ? indent + body.slice(indentEnd(body)) : body);
  replace(h, l.to, l.to, inserted);
  select(h, l.to + inserted.length);
  return l.number;
}

/** 0-based numbers of the lines the main selection touches, like TodoPaper's getSelectedLines. */
function selectedLines(h: EditorHost): number[] {
  const { from, to } = main(h);
  const first = lineOf(h, from);
  return Array.from({ length: lineOf(h, to) - first + 1 }, (_, i) => first + i);
}

/** 0-based numbers of the lines not hidden by the search or folds. */
function visibleLines(h: EditorHost): number[] {
  const lines: number[] = [];
  for (let n = 1; n <= doc(h).lines; n++) if (!isLineHidden(h.state(), n)) lines.push(n - 1);
  return lines;
}

/** TodoPaper's AddToProject: append an item (as a task unless makeTask is false) to a project, creating it if needed. */
function addToProject(h: EditorHost, text: unknown, project: unknown, makeTask = true): null {
  const item = makeTask ? `- ${String(text ?? "")}` : String(text ?? "");
  const spec = cmd.addToProject(h.state(), item, String(project ?? "") || "New Project");
  if (spec) h.dispatch(spec);
  return null;
}

const METHODS: Record<string, Method> = {
  // text
  GetText: (h) => doc(h).sliceString(0, undefined, h.eol()),
  GetValue: (h) => doc(h).sliceString(0, undefined, h.eol()),
  SetText: (h, text) => replace(h, 0, doc(h).length, text),
  SetValue: (h, text) => replace(h, 0, doc(h).length, text),
  ClearAll: (h) => replace(h, 0, doc(h).length, ""),
  GetLength: (h) => byteLength(doc(h), h.eol()),
  GetTextLength: (h) => byteLength(doc(h), h.eol()),
  GetLineCount: (h) => doc(h).lines,
  GetLine: (h, line) => lineWithEol(h, line),
  getLineText: (h, line) => line0(h, line).text,
  GetCurLine: (h) => {
    const head = main(h).head;
    const l = doc(h).lineAt(head);
    return [lineWithEol(h, l.number - 1), utf8Length(l.text.slice(0, head - l.from))];
  },
  GetSelectedText: (h) => doc(h).sliceString(main(h).from, main(h).to, h.eol()),
  GetTextRange: (h, start, end) => {
    const [a, b] = [toPos(h, start), toPos(h, end)];
    return doc(h).sliceString(Math.min(a, b), Math.max(a, b), h.eol());
  },
  // positions and selection
  GetCurrentPos: (h) => toByte(h, main(h).head),
  GetAnchor: (h) => toByte(h, main(h).anchor),
  SetCurrentPos: (h, pos) => select(h, main(h).anchor, toPos(h, pos)),
  SetAnchor: (h, pos) => select(h, toPos(h, pos), main(h).head),
  SetPos: (h, pos) => select(h, toPos(h, pos)),
  GotoPos: (h, pos) => select(h, toPos(h, pos)),
  GotoLine: (h, line) => select(h, line0(h, line).from),
  GetSelection: (h) => [toByte(h, main(h).from), toByte(h, main(h).to)],
  GetSelectionStart: (h) => toByte(h, main(h).from),
  GetSelectionEnd: (h) => toByte(h, main(h).to),
  SetSelection: (h, start, end) => select(h, toPos(h, start), end === -1 ? doc(h).length : toPos(h, end)),
  SetSelectionStart: (h, pos) => select(h, toPos(h, pos), Math.max(toPos(h, pos), main(h).head)),
  SetSelectionEnd: (h, pos) => select(h, Math.min(main(h).anchor, toPos(h, pos)), toPos(h, pos)),
  ClearSelection: (h) => select(h, main(h).from),
  SelectAll: (h) => select(h, 0, doc(h).length),
  SelectLine: (h, line) => select(h, line0(h, line).from, line0(h, line).to),
  DocumentStart: (h) => select(h, 0),
  DocumentEnd: (h) => select(h, doc(h).length),
  GetCurrentLine: (h) => lineOf(h, main(h).head),
  LineFromPosition: (h, pos) => lineOf(h, toPos(h, pos)),
  PositionFromLine: (h, line) => lineStartByte(doc(h), line, h.eol()),
  GetLineStartPosition: (h, line) => lineStartByte(doc(h), line, h.eol()),
  GetLineEndPosition: (h, line) => lineStartByte(doc(h), line, h.eol()) + utf8Length(line0(h, line).text),
  getLineSpan: (h, line) => [lineStartByte(doc(h), line, h.eol()), lineStartByte(doc(h), line, h.eol()) + utf8Length(line0(h, line).text)],
  LineLength: (h, line) => utf8Length(lineWithEol(h, line)),
  // editing
  AddText: (h, text) => replace(h, main(h).head, main(h).head, text, true),
  InsertText: (h, pos, text) => {
    const at = pos === -1 ? main(h).head : toPos(h, pos);
    return replace(h, at, at, text);
  },
  AppendText: (h, text) => replace(h, doc(h).length, doc(h).length, text),
  ReplaceSelection: (h, text) => replace(h, main(h).from, main(h).to, text, true),
  Clear: (h) => replace(h, main(h).from, main(h).to, ""),
  LineDelete: (h) => deleteLine(h, lineOf(h, main(h).head)),
  deleteLine: (h, line) => deleteLine(h, line),
  replaceLine: (h, line, text = "") => replace(h, line0(h, line).from, line0(h, line).to, text),
  insertLine: (h, line, text, before = false, autoIndent = true) => insertLine(h, line, text, before, autoIndent),
  BeginUndoAction: (h) => (h.dispatch(beginUndoGroup()), null),
  EndUndoAction: (h) => (endUndoGroup(h.state()).forEach((spec) => h.dispatch(spec)), null),
  CanUndo: (h) => undoDepth(h.state()) > 0,
  CanRedo: (h) => redoDepth(h.state()) > 0,
  // TodoPaper document model
  getSelectedLines: (h) => selectedLines(h),
  GetAllVisibleLines: (h) => visibleLines(h),
  GetAllVisibleText: (h) => visibleLines(h).map((n) => line0(h, n).text).join(h.eol()),
  GetIndentLevel: (h, line) => indentLevel(line0(h, line).text),
  getProjectNameFromLine: (h, line) => projectName(line0(h, line).text),
  isLineTask: (h, line) => getOutline(h.state()).infos[clampLine(doc(h), line)].type === "task",
  isLineTitle: (h, line) => getOutline(h.state()).infos[clampLine(doc(h), line)].type === "project",
  getAllTags: (h) => collectTags(getOutline(h.state()).infos, getConfig(h.state()).defaultTags),
  getAllProjects: (h) => listProjects(getOutline(h.state())).map((p) => [p.name, lineStartByte(doc(h), p.line, h.eol()), p.level]),
  GetInboxName: (h) => getConfig(h.state()).inbox,
  AddToProject: (h, text, project, makeTask = true) => addToProject(h, text, project, makeTask),
  AddToInbox: (h, text) => addToProject(h, text, getConfig(h.state()).inbox),
  markTag: (h, line, tag) => replace(h, line0(h, line).to, line0(h, line).to, " @" + String(tag).replace(/^@/, "")),
  toggleTag: (h, line, tag) => (h.dispatch(cmd.toggleTagLines(h.state(), [clampLine(doc(h), line) + 1], String(tag).replace(/^@/, ""))), null),
  doTagDone: (h, line) => (h.dispatch(cmd.toggleDoneLines(h.state(), [clampLine(doc(h), line) + 1])), null),
  // TodoPaper commands with arguments
  tagPriority: (h, level) => (h.runAction(`priority${level}`), null),
  MoveCurrentLineUp: (h, group = false) => (h.runAction(group ? "moveTreeUp" : "moveUp"), null),
  MoveCurrentLineDown: (h, group = false) => (h.runAction(group ? "moveTreeDown" : "moveDown"), null),
  ShowAllFolds: (h, show = true) => (h.runAction(show ? "expandAll" : "collapseAll"), null),
  Search: (h, text) => (h.setSearch(String(text ?? "")), null),
  Save: async (h) => (await h.save(), null),
  tag_register_callback: (h, tag) => (h.watchTag(String(tag)), null),
  tag_unregister_callbacks: (h, tag) => (h.unwatchTag(String(tag)), null),
};

/** Place Python keyword arguments after the positional ones, by parameter name. */
function placeArgs(name: string, args: unknown[], kwargs: Record<string, unknown> = {}): unknown[] {
  const keys = Object.keys(kwargs);
  if (!keys.length) return args;
  const params = PARAMS[name];
  const placed = [...args];
  for (const key of keys) {
    const index = params?.indexOf(key) ?? -1;
    if (index < 0) throw new Error(`${name}() got an unexpected keyword argument '${key}'`);
    placed[index] = kwargs[key];
  }
  return placed;
}

/** Names of all editor methods plugins can call. */
export function editorMethodNames(): string[] {
  return [...Object.keys(METHODS), ...Object.keys(ACTION_METHODS)].sort();
}

/** Run one editor method for a Python plugin; returns its (JSON) result. */
export function editorCall(h: EditorHost, name: string, args: unknown[] = [], kwargs?: Record<string, unknown>): unknown {
  const action = Object.prototype.hasOwnProperty.call(ACTION_METHODS, name) ? ACTION_METHODS[name] : null;
  if (action) {
    h.runAction(action);
    return null;
  }
  const method = Object.prototype.hasOwnProperty.call(METHODS, name) ? METHODS[name] : null;
  if (!method) throw new Error(`Editor method ${name} is not available in Cetli`);
  return method(h, ...placeArgs(name, args, kwargs)) ?? null;
}
