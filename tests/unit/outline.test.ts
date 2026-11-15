/** Tests for the TodoPaper hierarchy rules (project ownership, ranges, blocks). */

import { describe, expect, test } from "vitest";
import { ancestors, blockEnd, buildOutline, collectTags, findProjects, isInsideProject, lastContentLine, listProjects } from "../../src/core/outline";

const lines = (s: string) => s.split("\n");

describe("project ownership", () => {
  test("unindented tasks belong to the project above (TodoPaper style)", () => {
    const o = buildOutline(lines("Inbox:\n- a\n- b\n\nWork:\n- c"));
    expect(Array.from(o.parent)).toEqual([-1, 0, 0, 0, -1, 4]);
    expect(o.end[0]).toBe(3);
    expect(o.end[4]).toBe(5);
  });

  test("indented children work too (TaskPaper style)", () => {
    const o = buildOutline(lines("A:\n\t- a\n\t\tnote\nB:"));
    expect(Array.from(o.parent)).toEqual([-1, 0, 0, -1]);
    expect(o.end[0]).toBe(2);
  });

  test("sub projects own indented lines; an outdented task returns to the parent", () => {
    const o = buildOutline(lines("A:\n\tSub:\n\t- s\n- a\nB:"));
    expect(Array.from(o.parent)).toEqual([-1, 0, 1, 0, -1]);
    expect(o.end[1]).toBe(2);
    expect(o.end[0]).toBe(3);
  });

  test("lines before the first project have no parent", () => {
    const o = buildOutline(lines("note\n- loose\nP:\n- t"));
    expect(Array.from(o.parent)).toEqual([-1, -1, -1, 2]);
  });

  test("blank lines inside a project belong to it", () => {
    const o = buildOutline(lines("P:\n- a\n\n- b\nQ:"));
    expect(o.parent[2]).toBe(0);
    expect(o.end[0]).toBe(3);
  });
});

describe("helpers", () => {
  const o = buildOutline(lines("P:\n\tSub:\n\t- x\n\t\tnote\n\t- y\n\n\nArchive:\n- old @done @archive(P)"));

  test("ancestors innermost first", () => {
    expect(ancestors(o, 3)).toEqual([1, 0]);
  });

  test("lastContentLine skips trailing blanks", () => {
    expect(o.end[0]).toBe(6);
    expect(lastContentLine(o, 0)).toBe(4);
  });

  test("blockEnd for projects and indented tasks", () => {
    expect(blockEnd(o, 1)).toBe(6);
    expect(blockEnd(o, 2)).toBe(3);
    expect(blockEnd(o, 4)).toBe(4);
  });

  test("findProjects is case-insensitive and exact", () => {
    expect(findProjects(o, "archive")).toEqual([7]);
    expect(findProjects(o, "Arch")).toEqual([]);
  });

  test("isInsideProject", () => {
    expect(isInsideProject(o, 8, "Archive")).toBe(true);
    expect(isInsideProject(o, 2, "Archive")).toBe(false);
  });

  test("listProjects reports depth", () => {
    expect(listProjects(o).map((p) => [p.name, p.depth])).toEqual([
      ["P", 0],
      ["Sub", 1],
      ["Archive", 0],
    ]);
  });

  test("collectTags merges defaults, skips archive, sorts", () => {
    const tags = collectTags(o.infos.concat(buildOutline(["- a @Work @today", "- b @work"]).infos), ["@today", "home"]);
    expect(tags).toEqual(["@done", "@home", "@today", "@Work"]);
  });
});
