/** Path helpers for documents: autosave backup names and file:/// links. */

/** Path of the autosave backup copy: "todo.txt" -> "todo (autosave).txt" (TodoPaper naming). */
export function backupPath(path: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  if (dot <= sep + 1) return `${path} (autosave)`;
  return `${path.slice(0, dot)} (autosave)${path.slice(dot)}`;
}

/** A file:/// URL for a local path (TodoPaper format: forward slashes, spaces as %20). */
export function fileUrl(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/ /g, "%20");
  return p.startsWith("/") ? `file://${p}` : `file:///${p}`;
}

export interface WriteFormat {
  lineEnding: "\n" | "\r\n" | "\r";
  encoding: string;
  bom: boolean;
}

/**
 * How TodoPaper (a Windows program) wrote a document: always UTF-8, with "\n"
 * line endings for .taskpaper files and "\r\n" for all others. A UTF-8 byte
 * order mark survived (TodoPaper kept it as text). Elsewhere the file's own
 * line endings are kept.
 */
export function todoPaperFormat(path: string, read: WriteFormat, windows: boolean): WriteFormat {
  const lineEnding = windows ? (/\.taskpaper$/i.test(path) ? "\n" : "\r\n") : read.lineEnding;
  const bom = read.encoding === "utf-8" && read.bom;
  return { lineEnding, encoding: "utf-8", bom };
}
