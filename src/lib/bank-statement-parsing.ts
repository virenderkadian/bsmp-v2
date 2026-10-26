// Pure parsing helpers for an uploaded bank statement — no DOM, no DB, no
// framework. Kept separate from bank-statement-matching.ts (which assumes
// clean rows already) so the messy, format-guessing part of this feature is
// independently testable.

const MONTH_ABBREVIATIONS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

// ExcelJS gives back a Date for a real date-formatted cell, but a formula
// cell comes back as { formula, result } and rich text as { richText }. Most
// bank statement exports are plain values, but this keeps either from
// silently becoming "[object Object]".
export function cellText(value: unknown): unknown {
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === "object") {
    if ("result" in value) {
      return (value as { result: unknown }).result;
    }
    if ("richText" in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join("");
    }
    if ("text" in value) {
      return (value as { text: unknown }).text;
    }
  }
  return value;
}

// Accepts a real Date, or text in the handful of formats Indian bank
// statements actually use: YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY, and
// DD-Mon-YYYY (e.g. "07-Jan-2027"). Returns null rather than guessing when
// the text doesn't match any of them — an unparseable row is dropped from
// the review table rather than matched against the wrong date.
export function parseStatementDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  match = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/);
  if (match) {
    const monthIndex = MONTH_ABBREVIATIONS.indexOf(match[2].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      return `${match[3]}-${String(monthIndex + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    }
  }

  return null;
}

// Strips currency symbols, thousands separators, and surrounding
// parentheses (some exports mark a debit as "(1,200.00)") before parsing.
export function parseStatementAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0 ? Math.abs(value) : null;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const cleaned = text.replace(/[₹$,\s()]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount !== 0 ? Math.abs(amount) : null;
}

// Best-effort header match for the column-mapping step's default selection
// — never trusted blindly, the operator confirms it before anything parses.
export function guessColumnIndex(headerRow: string[], keywords: string[]): number {
  const lowerHeaders = headerRow.map((header) => header.toLowerCase());
  for (const keyword of keywords) {
    const index = lowerHeaders.findIndex((header) => header.includes(keyword));
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}
