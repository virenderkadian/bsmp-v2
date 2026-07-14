export const THEME_IDS = ["warm-light", "refined-dark", "slate-cool", "sage"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "warm-light";

export const THEME_STORAGE_KEY = "bsmpops:theme";

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  description: string;
  swatch: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
};

export const THEMES: ThemeMeta[] = [
  {
    id: "warm-light",
    label: "Warm Light",
    description: "Cream and warm neutrals with a blue accent. The default look.",
    swatch: { bg: "#FAF8F3", surface: "#FFFFFF", accent: "#2563EB", text: "#2A2520" },
  },
  {
    id: "refined-dark",
    label: "Refined Dark",
    description: "Deep navy with a bright blue accent — easy on the eyes in low light.",
    swatch: { bg: "#0B1220", surface: "#151F32", accent: "#3B82F6", text: "#F1F5F9" },
  },
  {
    id: "slate-cool",
    label: "Slate Cool",
    description: "Crisp cool-gray neutrals with a blue accent. Clean and businesslike.",
    swatch: { bg: "#F1F5F9", surface: "#FFFFFF", accent: "#2563EB", text: "#0F172A" },
  },
  {
    id: "sage",
    label: "Sage",
    description: "Warm off-white with a muted green accent — calm and distinctive.",
    swatch: { bg: "#F7F6F0", surface: "#FFFFFF", accent: "#4B7B5A", text: "#2C2E22" },
  },
];

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return !!value && (THEME_IDS as readonly string[]).includes(value);
}
