// Palette data for the driver app's theme system: a color-family choice
// (Teal / Ocean / Indigo) crossed with light/dark. This file is pure data —
// no hooks, no persistence, no OS-scheme reading. See theme-preference.tsx
// for the stateful side (persisted appearance + themeId, resolving the two
// into the active Palette) — kept separate so this file stays trivially
// testable/reasoned-about and mirrors this app's existing convention of
// small single-purpose modules.

export type SemanticColors = {
  // Delivery status colors. Deliberately IDENTICAL across every color-family
  // theme below — they're safety/status signals (what got delivered, what
  // didn't), not brand decoration, so their meaning must never shift just
  // because the driver picked a different accent color.
  delivered: string;
  deliveredTint: string;
  skipped: string;
  skippedTint: string;
  pending: string;
  pendingTint: string;
  danger: string;
};

export type IdentityColors = {
  ground: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  brand: string;
  brandStrong: string;
  brandTint: string;
  onBrand: string;
};

export type Palette = IdentityColors & SemanticColors;

const semanticLight: SemanticColors = {
  delivered: "#15803d",
  deliveredTint: "#dcfce7",
  skipped: "#b45309",
  skippedTint: "#fdf0d8",
  pending: "#5f7168",
  pendingTint: "#eaf0ed",
  danger: "#b91c1c",
};

const semanticDark: SemanticColors = {
  delivered: "#4ade80",
  deliveredTint: "#10281b",
  skipped: "#fbbf24",
  skippedTint: "#2b2110",
  pending: "#93a59e",
  pendingTint: "#192821",
  danger: "#f87171",
};

export const THEME_IDS = ["teal", "ocean", "indigo"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

const identities: Record<ThemeId, { light: IdentityColors; dark: IdentityColors }> = {
  // The original "dawn dairy" identity — default.
  teal: {
    light: {
      ground: "#eef3f1",
      surface: "#ffffff",
      surface2: "#f6faf8",
      border: "#e1e8e4",
      borderStrong: "#cdd8d2",
      ink: "#0e1b17",
      inkSoft: "#56655f",
      inkFaint: "#8a9994",
      brand: "#0f766e",
      brandStrong: "#0b5f58",
      brandTint: "#d6efeb",
      onBrand: "#ffffff",
    },
    dark: {
      ground: "#081310",
      surface: "#10201b",
      surface2: "#16241f",
      border: "#23352d",
      borderStrong: "#2f463c",
      ink: "#e7efeb",
      inkSoft: "#93a59e",
      inkFaint: "#647a72",
      brand: "#2dd4bf",
      brandStrong: "#14b8a6",
      brandTint: "#0e312b",
      onBrand: "#04211d",
    },
  },
  // Blue — echoes the web admin app's accent family without copying its
  // cream/neutral tones; a driver who also sees the web app gets a familiar
  // brand color in a palette built for this app's own operational contrast.
  ocean: {
    light: {
      ground: "#eef4fb",
      surface: "#ffffff",
      surface2: "#f4f9fd",
      border: "#dde7f2",
      borderStrong: "#c3d4e8",
      ink: "#101c2e",
      inkSoft: "#55677e",
      inkFaint: "#8a97a8",
      brand: "#2563eb",
      brandStrong: "#1d4ed8",
      brandTint: "#dbeafe",
      onBrand: "#ffffff",
    },
    dark: {
      ground: "#070d17",
      surface: "#0f1a2c",
      surface2: "#142238",
      border: "#1f2e46",
      borderStrong: "#2c3e5a",
      ink: "#eaf0f9",
      inkSoft: "#93a3ba",
      inkFaint: "#64768f",
      brand: "#60a5fa",
      brandStrong: "#3b82f6",
      brandTint: "#16283f",
      onBrand: "#071018",
    },
  },
  // Violet — deliberately not a warm amber/orange: that hue is already taken
  // by the "Skipped" status color, and a brand accent that close to a status
  // color would make the two easy to mix up at a glance.
  indigo: {
    light: {
      ground: "#f3f0fb",
      surface: "#ffffff",
      surface2: "#f8f6fd",
      border: "#e3daf5",
      borderStrong: "#cbb9ec",
      ink: "#1e1533",
      inkSoft: "#6a5d85",
      inkFaint: "#a396bd",
      brand: "#6d28d9",
      brandStrong: "#5b21b6",
      brandTint: "#ede4fc",
      onBrand: "#ffffff",
    },
    dark: {
      ground: "#0e0a1a",
      surface: "#19122c",
      surface2: "#211836",
      border: "#2f2246",
      borderStrong: "#402f5c",
      ink: "#ede8f7",
      inkSoft: "#a99cc4",
      inkFaint: "#786a97",
      brand: "#a78bfa",
      brandStrong: "#8b5cf6",
      brandTint: "#241a3d",
      onBrand: "#120a20",
    },
  },
};

export const THEMES: Record<ThemeId, { light: Palette; dark: Palette }> = {
  teal: {
    light: { ...identities.teal.light, ...semanticLight },
    dark: { ...identities.teal.dark, ...semanticDark },
  },
  ocean: {
    light: { ...identities.ocean.light, ...semanticLight },
    dark: { ...identities.ocean.dark, ...semanticDark },
  },
  indigo: {
    light: { ...identities.indigo.light, ...semanticLight },
    dark: { ...identities.indigo.dark, ...semanticDark },
  },
};

export const THEME_META: Record<ThemeId, { label: string; swatch: string }> = {
  teal: { label: "Teal", swatch: identities.teal.light.brand },
  ocean: { label: "Ocean", swatch: identities.ocean.light.brand },
  indigo: { label: "Indigo", swatch: identities.indigo.light.brand },
};

export const DEFAULT_THEME_ID: ThemeId = "teal";

export const radius = { sm: 12, md: 15, lg: 20, pill: 999 };
export const space = (n: number) => n * 4;
