/** Tests for TodoPaper editing commands against real CodeMirror states. */

import { describe, expect, test } from "vitest";
import { NOW, apply, mk, show } from "./helpers";
import {
  addTagLines,
  addToProject,
  archiveDone,
  archiveLines,
  boldSelection,
  enter,
  jumpToProject,
  makeTasks,
  moveLines,
  moveLinesToProject,
  newProject,
  newTag,
  newTask,
  removeTagAt,
  selectHierarchy,
  selectLine,
  selectedLines,
  toggleCurrentFold,
  toggleDoneLines,
  toggleTagLines,
} from "../../src/editor/commands";
import { isFolded, setFold, setQuery } from "../../src/editor/visibility";

describe("toggle done", () => {
  test("adds @done with date and removes it again", () => {
    let s = mk("P:\n- write| report");
    s = apply(s, toggleDoneLines(s, [2], NOW));
    expect(s.doc.line(2).text).toBe("- write report @done(2026-11-15)");
    s = apply(s, toggleDoneLines(s, [2], NOW));
    expect(s.doc.line(2).text).toBe("- write report");
  });

  test("without date when autoTagDoneDate is off, custom date format", () => {
    let s = mk("- a", { autoTagDoneDate: false });
    s = apply(s, toggleDoneLines(s, [1], NOW));
    expect(s.doc.toString()).toBe("- a @done");
    let t = mk("- a", { dateFormat: "%d.%m.%y" });
    t = apply(t, toggleDoneLines(t, [1], NOW));
    expect(t.doc.toString()).toBe("- a @done(15.11.26)");
  });

  test("removes @done in the middle of the line, keeps other tags", () => {
    let s = mk("- a @done(2020-01-01) @work");
    s = apply(s, toggleDoneLines(s, [1], NOW));
    expect(s.doc.toString()).toBe("- a @work");
  });

  test("toggles each selected line individually and skips blank lines", () => {
    let s = mk("[- a\n\n- b @done]");
    s = apply(s, toggleDoneLines(s, selectedLines(s), NOW));
    expect(s.doc.toString()).toBe("- a @done(2026-11-15)\n\n- b");
  });

  test("does not double the space before trailing whitespace", () => {
    let s = mk("- a ");
    s = apply(s, toggleDoneLines(s, [1], NOW));
    expect(s.doc.toString()).toBe("- a @done(2026-11-15)");
  });
});

describe("toggle tags", () => {
  test("@today toggles", () => {
    let s = mk("- a");
    s = apply(s, toggleTagLines(s, [1], "today"));
    expect(s.doc.toString()).toBe("- a @today");
    s = apply(s, toggleTagLines(s, [1], "today"));
    expect(s.doc.toString()).toBe("- a");
  });

  test("priority toggles the exact tag, like TodoPaper (another value is added, same value removed)", () => {
    let s = mk("- a @priority(2) @x");
    s = apply(s, toggleTagLines(s, [1], "priority", "3"));
    expect(s.doc.toString()).toBe("- a @priority(2) @x @priority(3)");
    s = apply(s, toggleTagLines(s, [1], "priority", "3"));
    expect(s.doc.toString()).toBe("- a @priority(2) @x");
  });

  test("tag at the start of a note is removed with its trailing space", () => {
    let s = mk("@today buy milk");
    s = apply(s, toggleTagLines(s, [1], "today"));
    expect(s.doc.toString()).toBe("buy milk");
  });

  test("addTagLines skips lines that already have the tag", () => {
    let s = mk("- a @work\n- b");
    s = apply(s, addTagLines(s, [1, 2], "@work"));
    expect(s.doc.toString()).toBe("- a @work\n- b @work");
  });

  test("removeTagAt removes the tag under the position", () => {
    let s = mk("- a @one @two");
    s = apply(s, removeTagAt(s, 6));
    expect(s.doc.toString()).toBe("- a @two");
    expect(removeTagAt(s, 1)).toBeNull();
  });
});

describe("creating items", () => {
  test("new task below a project uses the project's indentation (TodoPaper)", () => {
    let s = mk("P:|\n\t- a");
    s = apply(s, newTask(s));
    expect(show(s)).toBe("P:\n- |\n\t- a");
    let t = mk("\tSub:|");
    t = apply(t, newTask(t));
    expect(show(t)).toBe("\tSub:\n\t- |");
  });

  test("new task below an empty top-level project is unindented", () => {
    let s = mk("Inbox:|");
    s = apply(s, newTask(s));
    expect(show(s)).toBe("Inbox:\n- |");
  });

  test("new task below a task keeps its indentation", () => {
    let s = mk("P:\n\t- a|");
    s = apply(s, newTask(s));
    expect(show(s)).toBe("P:\n\t- a\n\t- |");
  });

  test("new task on a note or blank line turns it into a task", () => {
    let s = mk("\tsome| note");
    s = apply(s, newTask(s));
    expect(s.doc.toString()).toBe("\t- some note");
    let b = mk("|");
    b = apply(b, newTask(b));
    expect(show(b)).toBe("- |");
  });

  test("makeTasks over several lines leaves tasks and projects alone", () => {
    let s = mk("P:\na\n- b\n\tc");
    s = apply(s, makeTasks(s, [1, 2, 3, 4]));
    expect(s.doc.toString()).toBe("P:\n- a\n- b\n\t- c");
  });

  test("new project is inserted above and its name selected", () => {
    let s = mk("- a\n\t- b|");
    s = apply(s, newProject(s));
    expect(show(s)).toBe("- a\n\t[New Project]:\n\t- b");
  });

  test("new tag is spaced from neighbours and 'tag' selected", () => {
    let s = mk("- a|b");
    s = apply(s, newTag(s));
    expect(show(s)).toBe("- a @[tag] b");
    let t = mk("- a |");
    t = apply(t, newTag(t));
    expect(show(t)).toBe("- a @[tag]");
  });

  test("bold wraps the selection", () => {
    let s = mk("- [very] important");
    s = apply(s, boldSelection(s));
    expect(s.doc.toString()).toBe("- *very* important");
    expect(boldSelection(mk("- a|"))).toBeNull();
  });
});

describe("Enter key", () => {
  const press = (doc: string, opts = {}) => {
    const s = mk(doc);
    return show(apply(s, enter(s, opts)));
  };

  test("end of project starts a task", () => {
    expect(press("Work:|")).toBe("Work:\n- |");
    expect(press("Work:|\n\t- a")).toBe("Work:\n- |\n\t- a");
  });

  test("ctrl+enter on a project gives a plain line", () => {
    expect(press("Work:|", { ctrl: true })).toBe("Work:\n|");
  });

  test("enter inside a project name splits normally", () => {
    expect(press("Wo|rk:")).toBe("Wo\n|rk:");
  });

  test("end of task continues with a new task, keeping indentation", () => {
    expect(press("\t- a|")).toBe("\t- a\n\t- |");
  });

  test("middle of task splits into a new task", () => {
    expect(press("- buy |milk")).toBe("- buy \n- |milk");
  });

  test("start of task opens a line above", () => {
    expect(press("\t|- a")).toBe("\t\n\t|- a");
  });

  test("empty task outdents, then clears at top level", () => {
    expect(press("\t- |")).toBe("- |");
    expect(press("- |")).toBe("|");
  });

  test("shift+enter on a task adds a task below regardless of cursor", () => {
    expect(press("- a|bc", { shift: true })).toBe("- abc\n- |");
    expect(press("- a|bc", { shift: true, ctrl: true })).toBe("- abc\n|");
  });

  test("notes keep indentation", () => {
    expect(press("\tnote|")).toBe("\tnote\n\t|");
  });

  test("auto indent can be disabled", () => {
    const s = mk("\tnote|", { autoIndent: false });
    expect(show(apply(s, enter(s)))).toBe("\tnote\n|");
  });

  test("selection is replaced", () => {
    expect(press("- a[bc]d")).toBe("- a\n|d");
  });
});

describe("selection helpers", () => {
  test("select line and hierarchy", () => {
    const s = mk("P:\n- a|\n\tchild\n\t\tdeeper\n- b");
    expect(show(apply(s, selectLine(s)))).toBe("P:\n[- a]\n\tchild\n\t\tdeeper\n- b");
    expect(show(apply(s, selectHierarchy(s)))).toBe("P:\n[- a\n\tchild\n\t\tdeeper]\n- b");
    const p = mk("P|:\n- a\nQ:");
    expect(show(apply(p, selectHierarchy(p)))).toBe("[P:\n- a]\nQ:");
  });

  test("selectedLines ignores a selection ending at a line start", () => {
    expect(selectedLines(mk("[a\nb\n]c"))).toEqual([1, 2]);
  });
});

describe("moving lines", () => {
  test("move a line up and down", () => {
    let s = mk("a\nb|\nc");
    s = apply(s, moveLines(s, -1));
    expect(show(s)).toBe("b|\na\nc");
    s = apply(s, moveLines(s, 1));
    s = apply(s, moveLines(s, 1));
    expect(show(s)).toBe("a\nc\nb|");
    expect(moveLines(s, 1)).toBeNull();
  });

  test("move several selected lines", () => {
    let s = mk("a\n[b\nc]\nd");
    s = apply(s, moveLines(s, 1));
    expect(show(s)).toBe("a\nd\n[b\nc]");
  });

  test("group move swaps whole projects", () => {
    let s = mk("A:\n- a1\nB:|\n- b1\n- b2");
    s = apply(s, moveLines(s, -1, true));
    expect(show(s)).toBe("B:|\n- b1\n- b2\nA:\n- a1");
    s = apply(s, moveLines(s, 1, true));
    expect(show(s)).toBe("A:\n- a1\nB:|\n- b1\n- b2");
  });

  test("group move keeps indented children with their task", () => {
    let s = mk("P:\n- a\n\tnote a\n- b|\n\tnote b");
    s = apply(s, moveLines(s, -1, true));
    expect(s.doc.toString()).toBe("P:\n- b\n\tnote b\n- a\n\tnote a");
  });

  test("moving past a folded project jumps over its hidden children", () => {
    let s = mk("- x|\nP:\n- p1\n- p2");
    s = apply(s, { effects: setFold.of({ pos: s.doc.line(2).from, folded: true }) });
    s = apply(s, moveLines(s, 1));
    expect(s.doc.toString()).toBe("P:\n- p1\n- p2\n- x");
  });

  test("a folded project moves with its children and stays folded", () => {
    let s = mk("Q:\n- q\nP:|\n- p1");
    s = apply(s, { effects: setFold.of({ pos: s.doc.line(3).from, folded: true }) });
    s = apply(s, moveLines(s, -1, true));
    expect(s.doc.toString()).toBe("P:\n- p1\nQ:\n- q");
    expect(isFolded(s, 0)).toBe(true);
  });

  test("move lines to another project", () => {
    let s = mk("A:\n- a1\n- a2\nB:\n- b1");
    s = apply(s, moveLinesToProject(s, [2, 3], "b"));
    expect(s.doc.toString()).toBe("A:\nB:\n- a1\n- a2\n- b1");
  });
});

describe("archive", () => {
  test("archives selected lines under an existing archive project", () => {
    let s = mk("Work:\n- a @done(2026-01-01)\n- b\nArchive:\n- old @archive(Work)");
    s = apply(s, archiveLines(s, [2]));
    expect(s.doc.toString()).toBe("Work:\n- b\nArchive:\n- a @done(2026-01-01) @archive(Work)\n- old @archive(Work)");
  });

  test("creates the archive project at the end when missing; spaces become underscores", () => {
    let s = mk("My Project:\n- a @done\n- b");
    s = apply(s, archiveLines(s, [2]));
    expect(s.doc.toString()).toBe("My Project:\n- b\n\nArchive:\n- a @done @archive(My_Project)");
  });

  test("archive done keeps document order and skips projects, archived and archive lines", () => {
    const doc = ["A:", "- a1 @done", "- a2", "B: @done", "- b1 @done", "Archive:", "- x @done @archive(A)"].join("\n");
    let s = mk(doc);
    s = apply(s, archiveDone(s));
    expect(s.doc.toString()).toBe(["A:", "- a2", "B: @done", "Archive:", "- a1 @done @archive(A)", "- b1 @done @archive(B)", "- x @done @archive(A)"].join("\n"));
  });

  test("lines without a project get a bare @archive", () => {
    let s = mk("- loose @done\nArchive:");
    s = apply(s, archiveDone(s));
    expect(s.doc.toString()).toBe("Archive:\n- loose @done @archive");
  });

  test("nothing to archive returns null", () => {
    expect(archiveDone(mk("A:\n- open"))).toBeNull();
  });

  test("archiving the last line of the document", () => {
    let s = mk("Archive:\nP:\n- last @done");
    s = apply(s, archiveDone(s));
    expect(s.doc.toString()).toBe("Archive:\n- last @done @archive(P)\nP:");
  });
});

describe("quick log: addToProject", () => {
  test("appends after the last non-blank line of the project", () => {
    let s = mk("Inbox:\n- a\n\nWork:\n- w");
    s = apply(s, addToProject(s, "- new", "Inbox"));
    expect(s.doc.toString()).toBe("Inbox:\n- a\n- new\n\nWork:\n- w");
  });

  test("uses the project's indentation (TodoPaper)", () => {
    let s = mk("\tWork:\n\t\t- w");
    s = apply(s, addToProject(s, "- new\n  - second", "work"));
    expect(s.doc.toString()).toBe("\tWork:\n\t\t- w\n\t- new\n\t- second");
  });

  test("finds the project like TodoPaper: the first line containing 'name:'", () => {
    let s = mk("Other:\n- check Inbox: mails\nInbox:\n- a");
    s = apply(s, addToProject(s, "- new", "Inbox"));
    expect(s.doc.toString()).toBe("Other:\n- check Inbox: mails\n- new\nInbox:\n- a");
  });

  test("creates the project at the top when missing", () => {
    let s = mk("Work:\n- w");
    s = apply(s, addToProject(s, "- new", "Inbox"));
    expect(s.doc.toString()).toBe("Inbox:\n- new\nWork:\n- w");
  });

  test("empty text does nothing", () => {
    expect(addToProject(mk("Inbox:"), "  \n ", "Inbox")).toBeNull();
  });
});

describe("navigation and folding", () => {
  test("jump to next and previous project", () => {
    let s = mk("A:\n- a|\nB:\n- b");
    s = apply(s, jumpToProject(s, 1));
    expect(s.doc.lineAt(s.selection.main.head).number).toBe(3);
    s = apply(s, jumpToProject(s, -1));
    expect(s.doc.lineAt(s.selection.main.head).number).toBe(1);
    expect(jumpToProject(s, -1)).toBeNull();
  });

  test("jump skips projects hidden by a search", () => {
    let s = mk("A:|\n- a\nB:\n- b\nC:\n- c x");
    s = apply(s, { effects: setQuery.of("x") });
    s = apply(s, jumpToProject(s, 1));
    expect(s.doc.lineAt(s.selection.main.head).number).toBe(5);
  });

  test("toggle current fold from a child line folds the parent and moves the cursor", () => {
    let s = mk("A:\n- a|\nB:");
    s = apply(s, toggleCurrentFold(s));
    expect(isFolded(s, 0)).toBe(true);
    expect(s.selection.main.head).toBe(0);
    s = apply(s, toggleCurrentFold(s));
    expect(isFolded(s, 0)).toBe(false);
  });
});
