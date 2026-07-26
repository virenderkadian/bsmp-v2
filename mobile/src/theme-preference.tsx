import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { DEFAULT_THEME_ID, THEMES, THEME_IDS, type Palette, type ThemeId } from "@/theme";

export type Appearance = "system" | "light" | "dark";

const APPEARANCE_KEY = "bsmp.driver.appearance";
const THEME_ID_KEY = "bsmp.driver.themeId";

function isThemeId(value: string | null): value is ThemeId {
  return !!value && (THEME_IDS as readonly string[]).includes(value);
}

function isAppearance(value: string | null): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

type ThemePreferenceValue = {
  appearance: Appearance;
  themeId: ThemeId;
  scheme: "light" | "dark";
  colors: Palette;
  setAppearance: (value: Appearance) => void;
  setThemeId: (value: ThemeId) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceValue | undefined>(undefined);

// Persists the driver's appearance (System/Light/Dark) and color-theme
// (Teal/Ocean/Indigo) choices in SecureStore — tiny strings, well within its
// size limits, and already used for the session token so no new storage
// mechanism — and resolves them against the OS scheme into the active
// Palette. "System" (the default, unless changed) means exactly what
// appearance always meant before this was configurable: follow the device's
// own light/dark setting.
export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const osScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    let active = true;
    (async () => {
      const [storedAppearance, storedThemeId] = await Promise.all([
        SecureStore.getItemAsync(APPEARANCE_KEY),
        SecureStore.getItemAsync(THEME_ID_KEY),
      ]);
      if (!active) return;
      if (isAppearance(storedAppearance)) setAppearanceState(storedAppearance);
      if (isThemeId(storedThemeId)) setThemeIdState(storedThemeId);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setAppearance = (value: Appearance) => {
    setAppearanceState(value);
    SecureStore.setItemAsync(APPEARANCE_KEY, value).catch(() => undefined);
  };

  const setThemeId = (value: ThemeId) => {
    setThemeIdState(value);
    SecureStore.setItemAsync(THEME_ID_KEY, value).catch(() => undefined);
  };

  const scheme: "light" | "dark" = appearance === "system" ? (osScheme === "dark" ? "dark" : "light") : appearance;
  const colors = THEMES[themeId][scheme];

  return (
    <ThemePreferenceContext.Provider value={{ appearance, themeId, scheme, colors, setAppearance, setThemeId }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useTheme(): ThemePreferenceValue {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemePreferenceProvider");
  }
  return context;
}
