import { useEffect, useState } from "react";

// Returns `value`, but updated only after it stops changing for `delayMs`.
// Used to turn free typing into occasional server round-trips instead of one
// request per keystroke.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
