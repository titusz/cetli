/**
 * Editor-level configuration (behavioural preferences that commands need),
 * provided to CodeMirror through a facet.
 */

import { EditorState, Facet } from "@codemirror/state";

export interface EditorConfig {
  /** strftime format used for @done(...) and @date(...) tags. */
  dateFormat: string;
  /** Append the date to @done when marking tasks done. */
  autoTagDoneDate: boolean;
  /** Keep the indentation of the current line on Enter. */
  autoIndent: boolean;
  /** Name of the project quick-logged items go to by default. */
  inbox: string;
  /** Tags always offered by autocompletion, e.g. ["@done", "@today"]. */
  defaultTags: string[];
  /** Name of the archive project. */
  archiveProject: string;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  dateFormat: "%Y-%m-%d",
  autoTagDoneDate: true,
  autoIndent: true,
  inbox: "Inbox",
  defaultTags: ["@done", "@today", "@home", "@work"],
  archiveProject: "Archive",
};

export const editorConfig = Facet.define<Partial<EditorConfig>, EditorConfig>({
  combine(values) {
    return Object.assign({}, DEFAULT_EDITOR_CONFIG, ...values);
  },
});

/** Read the effective editor config from a state. */
export function getConfig(state: EditorState): EditorConfig {
  return state.facet(editorConfig);
}
