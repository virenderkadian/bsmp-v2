import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { DEFAULT_THEME, THEME_IDS, THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "BSMPOPS V2",
  description: "Route operations, billing, payments, and reconciliation for dairy delivery teams.",
};

export type AccessibleCity = { id: string; code: string; name: string };

// Sets data-theme on <html> before the page paints, from whatever the user
// last picked (localStorage) — without this, the first frame renders the
// default theme and then visibly snaps to the saved one once React
// hydrates. Runs as a plain inline script (not a component) specifically so
// it executes synchronously, ahead of paint.
const noFoucThemeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var v=${JSON.stringify(THEME_IDS)};document.documentElement.setAttribute("data-theme", v.indexOf(t)!==-1?t:${JSON.stringify(DEFAULT_THEME)});}catch(e){document.documentElement.setAttribute("data-theme", ${JSON.stringify(DEFAULT_THEME)});}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await getCurrentUser();
  let cities: AccessibleCity[] = [];
  let activeCityId: string | null = null;

  if (user) {
    try {
      cities =
        user.role === "SUPERADMIN"
          ? await prisma.city.findMany({
              orderBy: { name: "asc" },
              select: { id: true, code: true, name: true },
            })
          : user.cityAssignments.map((assignment) => ({
              id: assignment.city.id,
              code: assignment.city.code,
              name: assignment.city.name,
            }));

      activeCityId = await getCurrentCityId();
    } catch {
      // No cities exist yet, or this user has no city assignment — the page
      // itself surfaces that state; the shell just renders without a city.
    }
  }

  return (
    <html lang="en" className="h-full antialiased" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFoucThemeScript }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <AppShell user={user} cities={cities} activeCityId={activeCityId}>
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
