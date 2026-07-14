"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isThemeId, type ThemeId } from "@/lib/theme";

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial value matches what the no-FOUC script (see layout.tsx) already
  // put on <html> before hydration — read it back from the DOM rather than
  // defaulting to DEFAULT_THEME here, or the first client render would
  // mismatch whatever the script actually set and briefly flash.
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof document === "undefined") {
      return DEFAULT_THEME;
    }
    const current = document.documentElement.dataset.theme;
    return isThemeId(current) ? current : DEFAULT_THEME;
  });

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  // Keep multiple open tabs in sync if the theme changes in another one.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isThemeId(event.newValue)) {
        setThemeState(event.newValue);
        document.documentElement.dataset.theme = event.newValue;
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
