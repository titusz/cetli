/** Spell checking helpers: which reported misspellings to show, and the language choices. */

import { findLinks, findTags } from "./parser";

/** A misspelled range within a line: [start, start + length) in UTF-16 units. */
export type SpellRange = [start: number, length: number];

/** TodoPaper's spelling languages (Enchant names) mapped to language tags. */
export const SPELLING_LANGUAGES: [tag: string, label: string][] = [
  ["en-US", "English (United States)"],
  ["en-GB", "English (United Kingdom)"],
  ["en-AU", "English (Australia)"],
  ["de-DE", "German (Germany)"],
  ["fr-FR", "French (France)"],
];

/** Convert an Enchant language name ("en_US") into a language tag ("en-US"). */
export function languageTag(name: string): string {
  return name.replace("_", "-");
}

/** Drop misspellings inside tags and links (they are not prose). */
export function keepSpellingRanges(text: string, ranges: SpellRange[]): SpellRange[] {
  const skip = [...findTags(text), ...findLinks(text)];
  return ranges.filter(([start, length]) => !skip.some((s) => start < s.to && start + length > s.from));
}
