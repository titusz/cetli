/**
 * Tag autocompletion: typing "@" after whitespace (or at line start) offers
 * the tags used in the document plus the configured default tags.
 */

import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { collectTags } from "../core/outline";
import { getConfig } from "./config";
import { outlineField } from "./model";

/** Completion source for tags. */
export function tagCompletions(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|\s)@[^\s()]*$/);
  if (!match) return null;
  const from = match.from + match.text.indexOf("@");
  const typed = context.state.sliceDoc(from, context.pos);
  const outline = context.state.field(outlineField);
  const tags = collectTags(outline.infos, getConfig(context.state).defaultTags);
  const counts = new Map<string, number>();
  for (const info of outline.infos) for (const t of info.tags) counts.set("@" + t.name.toLowerCase(), (counts.get("@" + t.name.toLowerCase()) ?? 0) + 1);
  const options = tags
    .filter((t) => t.toLowerCase() !== typed.toLowerCase() || (counts.get(t.toLowerCase()) ?? 0) > 1)
    .map((label) => ({ label, type: "keyword", boost: label.toLowerCase().startsWith(typed.toLowerCase()) ? 1 : 0 }));
  return { from, options, validFor: /^@[^\s()]*$/ };
}
