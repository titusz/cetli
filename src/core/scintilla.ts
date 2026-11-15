/**
 * Scintilla-style document positions for TodoPaper plugins.
 *
 * TodoPaper's editor (Scintilla) addressed text by UTF-8 byte offsets into the
 * document as loaded, line endings included (CRLF on Windows), with 0-based
 * line numbers. These helpers translate between those positions and
 * CodeMirror's UTF-16 positions so plugin code computes the same numbers it
 * did in TodoPaper.
 */

import type { Text } from "@codemirror/state";

/** Number of bytes a string takes in UTF-8. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Number of UTF-16 units in the longest prefix of `text` that fits in `bytes` UTF-8 bytes. */
function unitsForBytes(text: string, bytes: number): number {
  let used = 0;
  let units = 0;
  for (const ch of text) {
    used += utf8Length(ch);
    if (used > bytes) break;
    units += ch.length;
  }
  return units;
}

/** Clamp a 0-based line number to the document. */
export function clampLine(doc: Text, line: number): number {
  return Math.max(0, Math.min(doc.lines - 1, Math.trunc(line) || 0));
}

/** Byte offset of the start of a 0-based line. */
export function lineStartByte(doc: Text, line: number, eol: string): number {
  let bytes = 0;
  for (let n = 1; n <= clampLine(doc, line); n++) bytes += utf8Length(doc.line(n).text) + eol.length;
  return bytes;
}

/** Byte offset of a document position. */
export function posToByte(doc: Text, pos: number, eol: string): number {
  const line = doc.lineAt(Math.max(0, Math.min(doc.length, pos)));
  return lineStartByte(doc, line.number - 1, eol) + utf8Length(line.text.slice(0, pos - line.from));
}

/** Document position of a byte offset (offsets inside a line ending or a character snap back; past the end clamps). */
export function byteToPos(doc: Text, byte: number, eol: string): number {
  let rest = Math.max(0, Math.trunc(byte) || 0);
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const len = utf8Length(line.text);
    if (rest <= len) return line.from + unitsForBytes(line.text, rest);
    rest -= len + eol.length;
    if (rest < 0) return line.to;
  }
  return doc.length;
}

/** Total length in bytes, line endings included. */
export function byteLength(doc: Text, eol: string): number {
  return lineStartByte(doc, doc.lines - 1, eol) + utf8Length(doc.line(doc.lines).text);
}
