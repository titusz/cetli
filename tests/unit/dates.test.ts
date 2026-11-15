/** Tests for the strftime subset used by date tags. */

import { expect, test } from "vitest";
import { strftime } from "../../src/core/dates";

const D = new Date(2026, 0, 5, 14, 7, 9); // Monday, 5 Jan 2026 14:07:09

test("default TodoPaper format", () => {
  expect(strftime("%Y-%m-%d", D)).toBe("2026-01-05");
});

test("short year, time, names, literal percent", () => {
  expect(strftime("%y/%m/%d %H:%M:%S", D)).toBe("26/01/05 14:07:09");
  expect(strftime("%a %A %b %B %j", D)).toBe("Mon Monday Jan January 005");
  expect(strftime("%I %p %e 100%%", D)).toBe("02 PM 5 100%");
});

test("unknown directives are kept", () => {
  expect(strftime("%Q", D)).toBe("%Q");
});
