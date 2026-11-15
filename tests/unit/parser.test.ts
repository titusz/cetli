/** Tests for line classification, tags, links and bold spans. */

import { describe, expect, test } from "vitest";
import { findBold, hasDoneTag, findLinks, findTags, indentLevel, parseLine, projectName, tagText } from "../../src/core/parser";

describe("parseLine classification", () => {
  test("tasks start with '- ' after indentation", () => {
    expect(parseLine("- buy milk").type).toBe("task");
    expect(parseLine("\t\t- nested").type).toBe("task");
    expect(parseLine("-no space").type).toBe("note");
    expect(parseLine("-").type).toBe("note");
  });

  test("projects end with a colon, optionally followed by tags", () => {
    expect(parseLine("Inbox:").type).toBe("project");
    expect(parseLine("Work: @important").type).toBe("project");
    expect(parseLine("Work: @due(2026-01-01) @x").type).toBe("project");
    expect(parseLine("\tSub Project:").type).toBe("project");
    expect(parseLine("Inbox:   ").type).toBe("project");
  });

  test("lines with text after the colon are notes", () => {
    expect(parseLine("Note: something else").type).toBe("note");
    expect(parseLine("Time: 10:00").type).toBe("note");
    expect(parseLine("Project: @tag text").type).toBe("note");
    expect(parseLine("Project:@tag").type).toBe("note");
  });

  test("TodoPaper lexer quirks are reproduced", () => {
    // a tag after the text re-establishes the project (TodoPaper 1.1.5 behaviour)
    expect(parseLine("Call: Bob @today")).toMatchObject({ type: "project", name: "Call" });
    // any word ending in a colon makes a project when nothing follows
    expect(parseLine("Re: Meeting:")).toMatchObject({ type: "project", name: "Re: Meeting" });
    expect(parseLine(":").type).toBe("project");
    // "@x(" without closing parenthesis is a plain word
    expect(parseLine("Project: @due(soon").type).toBe("note");
  });

  test("a task ending with a colon stays a task", () => {
    expect(parseLine("- remember:").type).toBe("task");
  });

  test("blank and whitespace-only lines", () => {
    expect(parseLine("").type).toBe("blank");
    expect(parseLine("\t  ").type).toBe("blank");
  });

  test("done detection with and without date", () => {
    expect(parseLine("- a @done").done).toBe(true);
    expect(parseLine("- a @done(2024-01-02)").done).toBe(true);
    expect(parseLine("- a @doneish").done).toBe(false);
    expect(parseLine("- a mail@done.com").done).toBe(false);
    expect(parseLine("Project: @done").done).toBe(true);
    expect(parseLine("- a @done(x)y").done).toBe(false);
  });

  test("@done is case-sensitive for display, but Tag Done and Archive see any case (as TodoPaper)", () => {
    expect(parseLine("- a @DONE").done).toBe(false);
    expect(hasDoneTag("- a @DONE")).toBe(true);
    expect(hasDoneTag("- a @done(2026-01-01)")).toBe(true);
    expect(hasDoneTag("- a @doneish")).toBe(false);
    expect(hasDoneTag("- a mail@done.com")).toBe(false);
  });

  test("indentation levels", () => {
    expect(indentLevel("x")).toBe(0);
    expect(indentLevel("\tx")).toBe(1);
    expect(indentLevel("\t\tx")).toBe(2);
    expect(indentLevel("    x")).toBe(1);
    expect(indentLevel("  x")).toBe(0);
    expect(parseLine("\t- x").indentEnd).toBe(1);
  });

  test("project names drop the colon and trailing tags", () => {
    expect(projectName("Work Stuff: @a @b(1)")).toBe("Work Stuff");
    expect(projectName("\tSub:")).toBe("Sub");
    expect(projectName("- task:")).toBeNull();
    expect(parseLine("My Project:").name).toBe("My Project");
  });
});

describe("findTags", () => {
  test("finds names, values and offsets", () => {
    const tags = findTags("- task @today @due(2026-11-15) @priority(1)");
    expect(tags.map((t) => [t.name, t.value])).toEqual([
      ["today", null],
      ["due", "2026-11-15"],
      ["priority", "1"],
    ]);
    expect("- task @today".slice(tags[0].from, tags[0].to)).toBe("@today");
  });

  test("tag at line start; tag values cannot contain spaces (TodoPaper)", () => {
    expect(findTags("@start of line")[0].name).toBe("start");
    expect(findTags("- x @archive(My_Project)")[0].value).toBe("My_Project");
    expect(findTags("- x @archive(My Project)")).toEqual([]);
    expect(findTags("- x (@paren)")).toEqual([]);
  });

  test("ignores e-mail addresses and lone @", () => {
    expect(findTags("mail me at a@b.com or @ noon")).toEqual([]);
  });

  test("dashes and digits in tag names", () => {
    expect(findTags("- @iscc-schema @t2").map((t) => t.name)).toEqual(["iscc-schema", "t2"]);
  });
});

describe("links and bold", () => {
  test("finds urls and strips trailing punctuation", () => {
    const text = "see https://example.com/a?b=1, and www.cetli.org.";
    const spans = findLinks(text).map((s) => text.slice(s.from, s.to));
    expect(spans).toEqual(["https://example.com/a?b=1", "www.cetli.org"]);
  });

  test("file urls", () => {
    const text = "- open file:///C:/docs/a%20b.txt now";
    expect(findLinks(text).map((s) => text.slice(s.from, s.to))).toEqual(["file:///C:/docs/a%20b.txt"]);
  });

  test("bold spans", () => {
    const text = "- this is *very* important *really*";
    expect(findBold(text).map((s) => text.slice(s.from, s.to))).toEqual(["*very*", "*really*"]);
    expect(findBold("5 * 3 * 2")).toEqual([]);
  });
});

describe("tag helpers", () => {
  test("tagText", () => {
    expect(tagText("done")).toBe("@done");
    expect(tagText("done", "2026-01-01")).toBe("@done(2026-01-01)");
  });
});
