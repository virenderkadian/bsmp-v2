import type { ReactNode } from "react";

// Wraps every occurrence of `query` in `text` with a <mark>, case-insensitive.
// Used wherever a list is the result of a search, so it's visible which field
// (and which part of it) actually matched — otherwise a match on code or
// mobile is invisible when only the name is shown.
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const needle = query.trim();

  if (!needle) {
    return <>{text}</>;
  }

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;

  while (cursor <= text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor);

    if (index === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    parts.push(
      <mark key={index} className="rounded-sm bg-accent-soft text-accent-soft-text">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
  }

  return <>{parts}</>;
}
