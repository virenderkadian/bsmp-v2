import { useColorScheme } from "react-native";

// Palette mirrors the approved web design mockup (fresh "dawn dairy" teal, with
// semantic delivered/skipped/pending kept separate from the brand accent).
export type Palette = {
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
  delivered: string;
  deliveredTint: string;
  skipped: string;
  skippedTint: string;
  pending: string;
  pendingTint: string;
  danger: string;
};

const light: Palette = {
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
  delivered: "#15803d",
  deliveredTint: "#dcfce7",
  skipped: "#b45309",
  skippedTint: "#fdf0d8",
  pending: "#5f7168",
  pendingTint: "#eaf0ed",
  danger: "#b91c1c",
};

const dark: Palette = {
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
  delivered: "#4ade80",
  deliveredTint: "#10281b",
  skipped: "#fbbf24",
  skippedTint: "#2b2110",
  pending: "#93a59e",
  pendingTint: "#192821",
  danger: "#f87171",
};

export function useTheme(): { colors: Palette; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { colors: scheme === "dark" ? dark : light, scheme };
}

export const radius = { sm: 12, md: 15, lg: 20, pill: 999 };
export const space = (n: number) => n * 4;
