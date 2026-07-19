"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PageMetricProvider } from "@/components/admin/page-metric";
import { Sidebar } from "@/components/admin/sidebar";
import { TopBar } from "@/components/admin/top-bar";
import type { AccessibleCity } from "@/app/layout";
import type { CurrentUser } from "@/lib/current-user";
import { cn } from "@/lib/utils";

// Routes that render outside the app chrome entirely (no sidebar/top bar) —
// the unauthenticated auth screens, since they render before (or without) a
// full session.
const CHROMELESS_PATHS = ["/login", "/forgot-password", "/reset-password"];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "bsmpops:sidebar-collapsed";

export function AppLayout({
  children,
  user,
  cities,
  activeCityId,
}: {
  children: ReactNode;
  user: CurrentUser | null;
  cities: AccessibleCity[];
  activeCityId: string | null;
}) {
  const pathname = usePathname();
  const isChromeless = CHROMELESS_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  // Starts expanded on every render (server and first client paint match),
  // then syncs from the user's saved preference right after mount — avoids
  // a hydration mismatch at the cost of a one-frame flash on repeat visits.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (stored === "true") {
      // Reading an external system (localStorage) once on mount, not
      // syncing derived state — the case react-hooks/set-state-in-effect's
      // own guidance carves out. Doing this in the initializer instead
      // would desync the server-rendered and first-client-render HTML.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  };

  if (isChromeless) {
    return <div className="min-h-screen bg-app-bg transition-colors duration-200">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-app-bg text-text-primary transition-colors duration-200 print:bg-white print:text-slate-900">
      <Sidebar user={user} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div className={cn("transition-[padding] duration-200 print:pl-0", collapsed ? "lg:pl-20" : "lg:pl-72")}>
        <PageMetricProvider>
          <TopBar cities={cities} activeCityId={activeCityId} />
          <main className="px-4 py-6 sm:px-6 lg:px-8 print:p-0">
            <div className="mx-auto flex max-w-7xl flex-col gap-6 print:max-w-none print:gap-0">
              {children}
            </div>
          </main>
        </PageMetricProvider>
      </div>
    </div>
  );
}
