/**
 * Document hierarchy for the TodoPaper format.
 *
 * TodoPaper groups lines by project rather than by strict indentation: a
 * top-level project owns every following line up to the next top-level
 * project, even unindented tasks. Cetli keeps that rule and generalizes it
 * for nested projects:
 *
 *   A project at level L owns the following lines until it reaches a
 *   non-blank line that is either a project with level <= L, or a
 *   non-project line with level < L.
 *
 * So unindented tasks below a top-level project belong to it (TodoPaper
 * style), and indented children work as in TaskPaper.
 */

import { LineInfo, parseLine } from "./parser";

export interface Outline {
  infos: LineInfo[];
  /** Index of the owning project line, or -1. */
  parent: Int32Array;
  /** For project lines: last line (inclusive) of the project range. Otherwise the line itself. */
  end: Int32Array;
}

/** Decide whether a project (given its info) owns the non-blank line `info`. */
function owns(project: LineInfo, info: LineInfo): boolean {
  if (info.type === "project") return info.level > project.level;
  return info.level >= project.level;
}

/** Build the outline from already-parsed line infos. */
export function outlineFromInfos(infos: LineInfo[]): Outline {
  const n = infos.length;
  const parent = new Int32Array(n);
  const end = new Int32Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const info = infos[i];
    end[i] = i;
    if (info.type !== "blank") {
      while (stack.length && !owns(infos[stack[stack.length - 1]], info)) {
        end[stack.pop() as number] = i - 1;
      }
    }
    parent[i] = stack.length ? stack[stack.length - 1] : -1;
    if (info.type === "project") stack.push(i);
  }
  for (const p of stack) end[p] = n - 1;
  return { infos, parent, end };
}

/** Parse all lines and build the outline. */
export function buildOutline(lines: readonly string[]): Outline {
  return outlineFromInfos(lines.map(parseLine));
}

/** Return the chain of owning projects of line `i`, innermost first. */
export function ancestors(outline: Outline, i: number): number[] {
  const chain: number[] = [];
  for (let p = outline.parent[i]; p >= 0; p = outline.parent[p]) chain.push(p);
  return chain;
}

/** Return the last non-blank line within a project's range (the project line itself if empty). */
export function lastContentLine(outline: Outline, project: number): number {
  let last = outline.end[project];
  while (last > project && outline.infos[last].type === "blank") last--;
  return last;
}

/** Last line of the indentation subtree of a non-project line (blank lines end the subtree). */
export function indentBlockEnd(infos: LineInfo[], i: number): number {
  const level = infos[i].level;
  let last = i;
  for (let j = i + 1; j < infos.length; j++) {
    const info = infos[j];
    if (info.type === "blank" || info.level <= level) break;
    last = j;
  }
  return last;
}

/** Last line of the block rooted at line `i`: a whole project range, or an indentation subtree. */
export function blockEnd(outline: Outline, i: number): number {
  return outline.infos[i].type === "project" ? outline.end[i] : indentBlockEnd(outline.infos, i);
}

/** Find project lines whose name matches `name` (case-insensitive, trimmed). */
export function findProjects(outline: Outline, name: string): number[] {
  const wanted = name.trim().toLowerCase();
  const found: number[] = [];
  outline.infos.forEach((info, i) => {
    if (info.type === "project" && info.name.toLowerCase() === wanted) found.push(i);
  });
  return found;
}

/** True if line `i` lies inside a project with the given name (at any depth). */
export function isInsideProject(outline: Outline, i: number, name: string): boolean {
  const wanted = name.toLowerCase();
  return ancestors(outline, i).some((p) => outline.infos[p].name.toLowerCase() === wanted);
}

/** Collect unique tag names ("@name") used in the document plus defaults, sorted case-insensitively. */
export function collectTags(infos: LineInfo[], defaults: readonly string[] = []): string[] {
  const seen = new Map<string, string>();
  const add = (tag: string) => {
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  };
  defaults.forEach((t) => t.trim() && add("@" + t.trim().replace(/^@/, "")));
  for (const info of infos) {
    for (const tag of info.tags) {
      if (tag.name.toLowerCase() === "archive") continue;
      add("@" + tag.name);
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** A project entry for the outline sidebar and pickers. */
export interface ProjectEntry {
  line: number;
  name: string;
  level: number;
  depth: number;
}

/** List all projects with their nesting depth (number of owning projects). */
export function listProjects(outline: Outline): ProjectEntry[] {
  const entries: ProjectEntry[] = [];
  outline.infos.forEach((info, i) => {
    if (info.type !== "project") return;
    entries.push({ line: i, name: info.name, level: info.level, depth: ancestors(outline, i).length });
  });
  return entries;
}
