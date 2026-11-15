/**
 * In-memory log of warnings and errors (console, uncaught errors, plugin
 * failures) for Help > Show Debug Information, like TodoPaper's debug log.
 */

export interface LogEntry {
  time: string;
  level: "error" | "warn";
  message: string;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];

/** Format any value for the log. */
function text(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Add an entry to the log. */
export function logEntry(level: LogEntry["level"], ...values: unknown[]): void {
  entries.push({ time: new Date().toISOString().slice(11, 19), level, message: values.map(text).join(" ") });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** All logged entries, oldest first. */
export function logEntries(): readonly LogEntry[] {
  return entries;
}

/** Capture console warnings/errors and uncaught errors into the log. */
export function captureDiagnostics(): void {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logEntry(level, ...args);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => logEntry("error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logEntry("error", "Unhandled promise rejection:", e.reason));
}
