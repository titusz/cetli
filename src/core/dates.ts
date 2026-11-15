/**
 * Minimal strftime implementation for date tags (TodoPaper used Python's
 * strftime, default "%Y-%m-%d").
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Left-pad a number with zeros. */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Day of the year (1-366). */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

/** Format a single strftime directive character. */
function directive(c: string, d: Date): string {
  const h = d.getHours();
  switch (c) {
    case "Y": return String(d.getFullYear());
    case "y": return pad(d.getFullYear() % 100);
    case "m": return pad(d.getMonth() + 1);
    case "d": return pad(d.getDate());
    case "e": return String(d.getDate());
    case "H": return pad(h);
    case "I": return pad(h % 12 === 0 ? 12 : h % 12);
    case "M": return pad(d.getMinutes());
    case "S": return pad(d.getSeconds());
    case "p": return h < 12 ? "AM" : "PM";
    case "b": return MONTHS[d.getMonth()].slice(0, 3);
    case "B": return MONTHS[d.getMonth()];
    case "a": return DAYS[d.getDay()].slice(0, 3);
    case "A": return DAYS[d.getDay()];
    case "j": return pad(dayOfYear(d), 3);
    case "%": return "%";
    default: return "%" + c;
  }
}

/** Format `date` according to a strftime-style `format`. */
export function strftime(format: string, date: Date = new Date()): string {
  let out = "";
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === "%" && i + 1 < format.length) out += directive(format[++i], date);
    else out += c;
  }
  return out;
}
