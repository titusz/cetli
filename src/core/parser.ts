/**
 * Line-level parser for the TodoPaper / TaskPaper plain-text format.
 *
 * Every line is classified on its own as a project, task, note or blank line,
 * and its tags, links and bold spans are located. Hierarchy (which project a
 * line belongs to) is computed separately in `outline.ts`.
 *
 * The classification follows TodoPaper 1.1.5's rules exactly (quirks included),
 * which work on whitespace-separated words:
 * - task:    the line (after leading whitespace) starts with "- "
 * - project: a word ending in ":" on a non-task line, as long as no plain word
 *            follows it (tags may follow; a later tag re-establishes the project)
 * - note:    any other non-blank line
 * - tag:     a word starting with "@"; a word with "(" must end with ")"
 *            ("@due(2026-01-01)"), so tag values contain no spaces
 * - done:    a word that is exactly "@done" or "@done(...)"
 */

export type LineType = "project" | "task" | "note" | "blank";

/** A tag occurrence; offsets are relative to the line start, `to` is exclusive. */
export interface Tag {
  name: string;
  value: string | null;
  from: number;
  to: number;
}

/** A simple [from, to) span relative to the line start. */
export interface Span {
  from: number;
  to: number;
}

export interface LineInfo {
  type: LineType;
  /** Indentation level: tabs count 1, every 4 leading spaces count 1. */
  level: number;
  /** Offset of the first non-whitespace character. */
  indentEnd: number;
  tags: Tag[];
  done: boolean;
  /** Project name without the trailing colon (projects only, else ""). */
  name: string;
}

export const TAB_SPACES = 4;

const WORD_RE = /\S+/g;
const TRAILING_TAGS_RE = /(?:\s+@\S+)*\s*$/;
const URL_WORD_RE = /^[a-z+-]+:\/\/\S/i;
const DONE_TEXT_RE = /(^|\s)@done\b/i;
const LINK_RE = /\b(?:[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
const BOLD_RE = /\*[^*\s](?:[^*]*[^*\s])?\*/g;

/** Return the offset of the first non-whitespace character in `text`. */
export function indentEnd(text: string): number {
  let i = 0;
  while (i < text.length && (text[i] === "\t" || text[i] === " ")) i++;
  return i;
}

/** Compute the indentation level of `text` (tabs count 1, each 4 spaces count 1). */
export function indentLevel(text: string): number {
  let tabs = 0;
  let spaces = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\t") tabs++;
    else if (c === " ") spaces++;
    else break;
  }
  return tabs + Math.floor(spaces / TAB_SPACES);
}

/** A whitespace-separated word with its offset. */
interface Word {
  text: string;
  from: number;
}

/** Split a line into words (runs of non-whitespace). */
function words(text: string): Word[] {
  const out: Word[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text))) out.push({ text: m[0], from: m.index });
  return out;
}

/** True if a word is a tag: "@x", or "@x(...)" whose parenthesis is closed at the end. */
function isTagWord(w: string): boolean {
  return w.length > 1 && w[0] === "@" && (!w.includes("(") || w.endsWith(")"));
}

/** Turn a tag word into a Tag. */
function tagFromWord(w: Word): Tag {
  const paren = w.text.indexOf("(");
  const name = paren < 0 ? w.text.slice(1) : w.text.slice(1, paren);
  const value = paren < 0 ? null : w.text.slice(paren + 1, -1);
  return { name, value, from: w.from, to: w.from + w.text.length };
}

/** Find all tags in a line. */
export function findTags(text: string): Tag[] {
  if (text.indexOf("@") < 0) return [];
  return words(text).filter((w) => isTagWord(w.text)).map(tagFromWord);
}

/** True if the text carries a @done tag the way TodoPaper's Tag Done and Archive Done see it. */
export function hasDoneTag(text: string): boolean {
  return DONE_TEXT_RE.test(text);
}

type Kind = "note" | "project" | "task";

/** TodoPaper's line state: the kind plus the done flag (assigning a kind clears done). */
interface LexState {
  kind: Kind;
  done: boolean;
}

/** Classify a non-blank line exactly like TodoPaper does. */
function classify(text: string): LexState {
  let st: LexState = { kind: text.trimStart().startsWith("- ") ? "task" : "note", done: false };
  let seenProject = false;
  const tokens: ("projectword" | "tag" | "word" | "ws")[] = [];
  let last = 0;
  for (const w of words(text)) {
    if (w.from > last) {
      seenProject ||= st.kind === "project";
      tokens.push("ws");
    }
    last = w.from + w.text.length;
    seenProject ||= st.kind === "project";
    const t = w.text;
    if (t.endsWith(":") && st.kind !== "task") {
      tokens.push("projectword");
      st = { kind: "project", done: false };
    } else if (t[0] === "@" && t.length > 1) {
      if (t.includes("(") && !t.endsWith(")")) {
        tokens.push("word");
        if (st.kind === "project") st = { kind: "note", done: false };
      } else tokens.push("tag");
      if (seenProject) st = { kind: "project", done: false };
      if (t === "@done" || (t.startsWith("@done(") && t.endsWith(")"))) st = { ...st, done: true };
    } else if (t.includes("://") && URL_WORD_RE.test(t)) {
      tokens.push("word");
    } else {
      tokens.push("word");
      if (st.kind === "project") st = { kind: "note", done: false };
    }
  }
  if (st.kind === "project" && !text.endsWith(":")) {
    let kill = false;
    for (const tok of tokens) {
      if (tok === "ws") kill = true;
      else if (tok === "tag" && kill) kill = false;
    }
    if (kill) st = { kind: "note", done: false };
  }
  return st;
}

/** True if the line text is a task ("- " after indentation). */
export function isTaskText(text: string): boolean {
  const i = indentEnd(text);
  return text[i] === "-" && text[i + 1] === " ";
}

/** Name of a project line: the text before its colon, without trailing tags. */
function nameOf(text: string): string {
  const body = text.slice(indentEnd(text)).replace(TRAILING_TAGS_RE, "");
  const name = body.endsWith(":") ? body.slice(0, -1) : body.slice(0, Math.max(0, body.indexOf(":")));
  return name.trim();
}

/** Return the project name if `text` is a project line, otherwise null. */
export function projectName(text: string): string | null {
  const info = parseLine(text);
  return info.type === "project" ? info.name : null;
}

/** Classify and analyse a single line of text. */
export function parseLine(text: string): LineInfo {
  const start = indentEnd(text);
  const level = indentLevel(text);
  if (start === text.length) {
    return { type: "blank", level, indentEnd: start, tags: [], done: false, name: "" };
  }
  const tags = findTags(text);
  const { kind, done } = classify(text);
  return { type: kind, level, indentEnd: start, tags, done, name: kind === "project" ? nameOf(text) : "" };
}

/** Find URL-like links ("scheme://..." and "www....") in a line. */
export function findLinks(text: string): Span[] {
  if (text.indexOf("://") < 0 && text.toLowerCase().indexOf("www.") < 0) return [];
  const spans: Span[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text))) {
    let url = m[0];
    while (/[.,;:!?)\]}]$/.test(url)) url = url.slice(0, -1);
    if (url.length > 0) spans.push({ from: m.index, to: m.index + url.length });
  }
  return spans;
}

/** Find "*bold*" spans in a line. */
export function findBold(text: string): Span[] {
  if (text.indexOf("*") < 0) return [];
  const spans: Span[] = [];
  BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOLD_RE.exec(text))) spans.push({ from: m.index, to: m.index + m[0].length });
  return spans;
}

/** Render a tag back to text, e.g. "@due(2024-01-01)". */
export function tagText(name: string, value: string | null = null): string {
  return value === null ? `@${name}` : `@${name}(${value})`;
}
