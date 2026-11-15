/**
 * Parser for Python literal expressions (dict, list, tuple, str, numbers,
 * True/False/None), used to read TodoPaper's `todopaper.settings` file,
 * which stores its preferences as a Python dict repr.
 */

export type PyValue = string | number | boolean | null | PyValue[] | { [key: string]: PyValue };

/** Parse a Python literal; throws on malformed input. */
export function parsePyLiteral(src: string): PyValue {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(`${msg} at offset ${i}`);
  };

  const parseString = (): string => {
    if (src[i] === "u" || src[i] === "U" || src[i] === "r" || src[i] === "R") i++;
    const quote = src[i++];
    let out = "";
    while (i < src.length && src[i] !== quote) {
      const c = src[i++];
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = src[i++];
      const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0" };
      if (e in simple) out += simple[e];
      else if (e === "x") {
        out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
        i += 2;
      } else if (e === "u") {
        out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
        i += 4;
      } else out += "\\" + e;
    }
    if (src[i] !== quote) fail("Unterminated string");
    i++;
    return out;
  };

  const parseSeq = (close: string): PyValue[] => {
    const items: PyValue[] = [];
    ws();
    while (src[i] !== close) {
      items.push(parseValue());
      ws();
      if (src[i] === ",") i++;
      else if (src[i] !== close) fail(`Expected ',' or '${close}'`);
      ws();
    }
    i++;
    return items;
  };

  const parseDict = (): { [key: string]: PyValue } => {
    const obj: { [key: string]: PyValue } = {};
    ws();
    while (src[i] !== "}") {
      const key = parseValue();
      ws();
      if (src[i++] !== ":") fail("Expected ':'");
      obj[String(key)] = parseValue();
      ws();
      if (src[i] === ",") i++;
      else if (src[i] !== "}") fail("Expected ',' or '}'");
      ws();
    }
    i++;
    return obj;
  };

  const parseValue = (): PyValue => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      return parseDict();
    }
    if (c === "[") {
      i++;
      return parseSeq("]");
    }
    if (c === "(") {
      i++;
      return parseSeq(")");
    }
    if (c === "'" || c === '"' || (/[uUrR]/.test(c) && (src[i + 1] === "'" || src[i + 1] === '"'))) return parseString();
    const word = /^(True|False|None)\b/.exec(src.slice(i));
    if (word) {
      i += word[1].length;
      return word[1] === "True" ? true : word[1] === "False" ? false : null;
    }
    const num = /^[-+]?(\d+\.?\d*(e[-+]?\d+)?|\.\d+)[lL]?/i.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0].replace(/[lL]$/, ""));
    }
    return fail(`Unexpected character '${c}'`);
  };

  const value = parseValue();
  ws();
  if (i < src.length) fail("Trailing characters");
  return value;
}

/** Extract and parse the dict from a TodoPaper settings file (`settings = "{...}"`). */
export function parseTodoPaperSettings(fileText: string): { [key: string]: PyValue } | null {
  const start = fileText.indexOf('"');
  const end = fileText.lastIndexOf('"');
  const inner = start >= 0 && end > start ? fileText.slice(start + 1, end) : fileText;
  try {
    const value = parsePyLiteral(inner.trim());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
