/**
 * Performance checks on a large document shaped like a long-lived TodoPaper
 * file (unindented tasks, a big archive). Set CETLI_REAL_FILE to also run
 * read-only against a real document.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { apply, mk } from "./helpers";
import { archiveDone } from "../../src/editor/commands";
import { getVisibility, setQuery } from "../../src/editor/visibility";
import { getOutline } from "../../src/editor/model";

/** Build a synthetic document with `projects` projects and a large archive. */
function bigDoc(projects = 60, tasksPer = 50, archived = 3500): string {
  const out: string[] = [];
  for (let p = 0; p < projects; p++) {
    out.push(`Project ${p}:`);
    for (let t = 0; t < tasksPer; t++) out.push(`- task ${p}.${t} @tag${t % 7}${t % 5 === 0 ? " @done(2026-01-01)" : ""}`);
    out.push("");
    if (p === projects / 2) {
      out.push("Archive:");
      for (let a = 0; a < archived; a++) out.push(`- old ${a} @done(2025-01-01) @archive(Project_${a % 9})`);
      out.push("");
    }
  }
  return out.join("\n");
}

/** Time a function in milliseconds. */
function time(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

test("keystrokes stay fast on a ~7000 line document", () => {
  let s = mk(bigDoc());
  expect(s.doc.lines).toBeGreaterThan(6500);
  const line = s.doc.line(100);
  const keystroke = time(() => {
    for (let i = 0; i < 20; i++) s = apply(s, { changes: { from: line.to + i, insert: "x" } });
  });
  console.log(`20 keystrokes on ${s.doc.lines} lines: ${keystroke.toFixed(1)}ms`);
  expect(keystroke / 20).toBeLessThan(25);
});

test("search and archive on a large document", () => {
  let s = mk(bigDoc());
  const search = time(() => {
    s = apply(s, { effects: setQuery.of("@tag3 NOT @done") });
  });
  const visible = getVisibility(s).hidden.filter((h) => !h).length;
  console.log(`search: ${search.toFixed(1)}ms, ${visible} visible lines`);
  expect(search).toBeLessThan(150);
  s = apply(s, { effects: setQuery.of("") });
  const archive = time(() => {
    s = apply(s, archiveDone(s));
  });
  console.log(`archive done: ${archive.toFixed(1)}ms`);
  expect(archive).toBeLessThan(500);
});

test.runIf(!!process.env.CETLI_REAL_FILE)("real document parses and searches (read-only)", () => {
  const text = readFileSync(process.env.CETLI_REAL_FILE as string, "utf8").replace(/\r\n?/g, "\n");
  let s = mk(text);
  const outline = getOutline(s);
  const counts = { project: 0, task: 0, note: 0, blank: 0 };
  outline.infos.forEach((i) => counts[i.type]++);
  console.log("real file:", s.doc.lines, "lines", counts);
  const search = time(() => {
    s = apply(s, { effects: setQuery.of("NOT @done") });
  });
  console.log(`real file search: ${search.toFixed(1)}ms`);
  expect(counts.project).toBeGreaterThan(0);
});
