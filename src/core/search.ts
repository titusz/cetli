/**
 * Search queries that filter the document view (TodoPaper search syntax).
 *
 * - Space-separated terms must all appear in a line (case-insensitive substring).
 * - "NOT"/"!", "OR"/"|", "AND"/"&" set how the following terms combine with the
 *   result so far, until the next operator (TodoPaper semantics); evaluation runs
 *   left to right without precedence.
 * - "quoted phrases" are matched as one term.
 * - "<Project Name>" restricts the search to the lines where "Project Name:"
 *   occurs (case-insensitive, anywhere in the line, as TodoPaper did): a
 *   project line contributes its whole range, any other line just itself.
 *   Without other terms it shows those lines.
 *
 * Matching lines are shown together with their owning project for context.
 */

import { Outline } from "./outline";

export type Operator = "AND" | "OR" | "NOT";

export interface Term {
  op: Operator;
  text: string;
}

export interface Query {
  projects: string[];
  terms: Term[];
}

const OPERATORS: Record<string, Operator> = { NOT: "NOT", "!": "NOT", OR: "OR", "|": "OR", AND: "AND", "&": "AND" };
const PROJECT_RE = /<([^<>]+)>/g;
const TOKEN_RE = /"([^"]*)"|(\S+)/g;

/** Parse a raw search string into project filters and boolean terms. */
export function parseQuery(raw: string): Query {
  const projects: string[] = [];
  const rest = raw.replace(PROJECT_RE, (_, name: string) => {
    if (name.trim()) projects.push(name.trim());
    return " ";
  });
  const terms: Term[] = [];
  let op: Operator = "AND";
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(rest))) {
    const quoted = m[1] !== undefined;
    const token = quoted ? m[1] : m[2];
    if (!quoted && token in OPERATORS) {
      op = OPERATORS[token];
      continue;
    }
    if (token.length > 0) terms.push({ op, text: token.toLowerCase() });
  }
  return { projects, terms };
}

/** True if the query has nothing to filter on. */
export function isEmptyQuery(query: Query): boolean {
  return query.projects.length === 0 && query.terms.length === 0;
}

/** Evaluate boolean terms against a line of text. */
export function matchesTerms(text: string, terms: readonly Term[]): boolean {
  const lower = text.toLowerCase();
  let matched = true;
  for (const term of terms) {
    const hit = lower.includes(term.text);
    if (term.op === "AND") matched = matched && hit;
    else if (term.op === "OR") matched = matched || hit;
    else matched = matched && !hit;
  }
  return matched;
}

/** Lines the query looks at: lines mentioning "<name>:" (projects with their range), or every line. */
function candidateLines(outline: Outline, lines: readonly string[], query: Query): number[] {
  const n = outline.infos.length;
  if (query.projects.length === 0) return Array.from({ length: n }, (_, i) => i);
  const picked = new Uint8Array(n);
  for (const name of query.projects) {
    const needle = name.toLowerCase() + ":";
    for (let i = 0; i < n; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      const last = outline.infos[i].type === "project" ? outline.end[i] : i;
      picked.fill(1, i, last + 1);
    }
  }
  const result: number[] = [];
  picked.forEach((v, i) => v && result.push(i));
  return result;
}

/**
 * Compute which lines are visible for a query. Returns a flag per line (1 = visible).
 * An empty query shows everything.
 */
export function visibleLines(outline: Outline, lines: readonly string[], query: Query): Uint8Array {
  const n = outline.infos.length;
  const visible = new Uint8Array(n);
  if (isEmptyQuery(query)) return visible.fill(1);
  for (const i of candidateLines(outline, lines, query)) {
    if (visible[i] || !matchesTerms(lines[i], query.terms)) continue;
    visible[i] = 1;
    if (outline.parent[i] >= 0) visible[outline.parent[i]] = 1;
  }
  return visible;
}

/** Escape a project name for use inside "<...>". */
export function projectToken(name: string): string {
  return `<${name}>`;
}

/**
 * Toggle a token (a tag like "@work" or a project token like "<Work>") inside a
 * search string: remove it when present, otherwise add it. Projects go first.
 */
export function toggleSearchToken(search: string, token: string): string {
  const parts = search.trim().length ? splitTokens(search.trim()) : [];
  const idx = parts.findIndex((p) => p.toLowerCase() === token.toLowerCase());
  if (idx >= 0) parts.splice(idx, 1);
  else if (token.startsWith("<")) parts.unshift(token);
  else parts.push(token);
  return parts.join(" ");
}

/** Split a search string into tokens, keeping "<Project Name>" and "quoted phrases" whole. */
export function splitTokens(search: string): string[] {
  const tokens: string[] = [];
  const re = /<[^<>]*>|"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(search))) tokens.push(m[0]);
  return tokens;
}
