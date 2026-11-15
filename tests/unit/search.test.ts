/** Tests for search query parsing, matching and visible-line computation. */

import { describe, expect, test } from "vitest";
import { buildOutline } from "../../src/core/outline";
import { matchesTerms, parseQuery, splitTokens, toggleSearchToken, visibleLines } from "../../src/core/search";

const DOC = ["Inbox:", "- call bob @today", "- write report @done(2026-01-01)", "", "Work:", "- fix bug @today", "\tdetails", "Home:", "- garden"];

/** Visible line indexes for a query over DOC. */
function visible(query: string): number[] {
  const flags = visibleLines(buildOutline(DOC), DOC, parseQuery(query));
  return Array.from(flags).flatMap((v, i) => (v ? [i] : []));
}

describe("parseQuery", () => {
  test("terms, operators and projects", () => {
    expect(parseQuery("<Work> @today NOT @done")).toEqual({
      projects: ["Work"],
      terms: [
        { op: "AND", text: "@today" },
        { op: "NOT", text: "@done" },
      ],
    });
  });

  test("quoted phrases and symbol operators", () => {
    expect(parseQuery('"call bob" | garden ! x').terms).toEqual([
      { op: "AND", text: "call bob" },
      { op: "OR", text: "garden" },
      { op: "NOT", text: "x" },
    ]);
    expect(parseQuery("a | b c").terms.map((t) => t.op)).toEqual(["AND", "OR", "OR"]);
  });

  test("lowercase 'not' is a normal term", () => {
    expect(parseQuery("not").terms).toEqual([{ op: "AND", text: "not" }]);
  });

  test("project names with spaces", () => {
    expect(parseQuery("<My Big Project>").projects).toEqual(["My Big Project"]);
  });
});

describe("matchesTerms", () => {
  test("operators stay active for following terms until the next operator (TodoPaper)", () => {
    const terms = parseQuery("NOT @done @today").terms;
    expect(terms.map((t) => t.op)).toEqual(["NOT", "NOT"]);
    expect(matchesTerms("- a", terms)).toBe(true);
    expect(matchesTerms("- a @today", terms)).toBe(false);
    expect(matchesTerms("- a @done", terms)).toBe(false);
    const mixed = parseQuery("@today NOT @done AND call").terms;
    expect(matchesTerms("- call bob @today", mixed)).toBe(true);
    expect(matchesTerms("- write @today", mixed)).toBe(false);
  });

  test("OR and case-insensitivity", () => {
    const terms = parseQuery("BOB OR garden").terms;
    expect(matchesTerms("- call bob", terms)).toBe(true);
    expect(matchesTerms("- Garden", terms)).toBe(true);
    expect(matchesTerms("- other", terms)).toBe(false);
  });
});

describe("visibleLines", () => {
  test("empty query shows everything", () => {
    expect(visible("  ")).toEqual(DOC.map((_, i) => i));
  });

  test("matches come with their project", () => {
    expect(visible("@today")).toEqual([0, 1, 4, 5]);
  });

  test("NOT @done hides done items but keeps others (and blank lines)", () => {
    expect(visible("NOT @done")).toEqual([0, 1, 3, 4, 5, 6, 7, 8]);
  });

  test("project filter alone shows the whole project", () => {
    expect(visible("<work>")).toEqual([4, 5, 6]);
  });

  test("project filter combined with terms", () => {
    expect(visible("<Inbox> report")).toEqual([0, 2]);
  });

  test("unknown project shows nothing", () => {
    expect(visible("<Nope>")).toEqual([]);
  });

  test("a matching project line shows without its children", () => {
    expect(visible("home")).toEqual([7]);
  });

  test("matches in sub projects show only the direct parent project (TodoPaper)", () => {
    const doc = ["Top:", "	Sub:", "	- deep match", "Other:"];
    const flags = visibleLines(buildOutline(doc), doc, parseQuery("match"));
    expect(Array.from(flags)).toEqual([0, 1, 1, 0]);
  });
});

describe("search token toggling", () => {
  test("adds and removes tags and projects", () => {
    expect(toggleSearchToken("", "@today")).toBe("@today");
    expect(toggleSearchToken("@today", "@work")).toBe("@today @work");
    expect(toggleSearchToken("@today @work", "@TODAY")).toBe("@work");
    expect(toggleSearchToken("@work", "<My Project>")).toBe("<My Project> @work");
    expect(toggleSearchToken("<My Project> @work", "<My Project>")).toBe("@work");
  });

  test("splitTokens keeps projects and quotes whole", () => {
    expect(splitTokens('<A B> "c d" e')).toEqual(["<A B>", '"c d"', "e"]);
  });
});
