"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AccessibleCity } from "@/app/layout";
import { setActiveCity } from "@/app/session-actions";
import { ArrowLeftIcon, InfoIcon } from "@/components/admin/icons";
import { useTopBarMetric } from "@/components/admin/page-metric";
import { appNavigation } from "@/lib/navigation";

// Titles/subtitles for sub-routes that aren't in the sidebar nav, so the
// top bar still shows a real title instead of the "Dashboard" fallback.
// `backHref` renders a back arrow before the title (for drill-in screens).
const EXTRA_PAGES: Record<string, { title: string; subtitle: string; backHref?: string }> = {
  "/payments/bulk-entry": {
    title: "Bulk Route Payments",
    subtitle: "Enter route-wise customer collections in a fast tally-style workflow.",
    backHref: "/payments",
  },
};

const METRIC_TONE_CLASSES: Record<string, string> = {
  info: "border-status-info-text/25 bg-status-info-bg text-status-info-text",
  success: "border-status-success-text/25 bg-status-success-bg text-status-success-text",
  warning: "border-status-warning-text/25 bg-status-warning-bg text-status-warning-text",
  danger: "border-status-danger-text/25 bg-status-danger-bg text-status-danger-text",
};

function MetricPill() {
  const metric = useTopBarMetric();

  if (!metric) {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        METRIC_TONE_CLASSES[metric.tone ?? "info"]
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      <span className="opacity-80">{metric.label}</span>
      <span>{metric.value}</span>
    </span>
  );
}

function CitySwitcher({ cities, activeCityId }: { cities: AccessibleCity[]; activeCityId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (cities.length === 0) {
    return null;
  }

  if (cities.length === 1) {
    return (
      <div className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-text-secondary">
        {cities[0].name}
      </div>
    );
  }

  return (
    <select
      value={activeCityId ?? ""}
      disabled={pending}
      onChange={async (event) => {
        setPending(true);
        await setActiveCity(event.target.value);
        router.refresh();
        setPending(false);
      }}
      className="h-10 rounded-lg border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
      aria-label="Switch city"
    >
      {cities.map((city) => (
        <option key={city.id} value={city.id}>
          {city.name}
        </option>
      ))}
    </select>
  );
}

export function TopBar({
  cities,
  activeCityId,
}: {
  cities: AccessibleCity[];
  activeCityId: string | null;
}) {
  const pathname = usePathname();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000 * 30);
    return () => window.clearInterval(timer);
  }, []);

  const currentPage = useMemo(
    () => appNavigation.find((item) => item.href === pathname) ?? EXTRA_PAGES[pathname],
    [pathname],
  );

  return (
    <header className="sticky top-0 z-20 border-b border-surface-border bg-app-bg/95 px-6 py-3 backdrop-blur transition-colors duration-200 print:hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          {currentPage && "backHref" in currentPage && currentPage.backHref ? (
            <Link
              href={currentPage.backHref}
              aria-label="Go back"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-surface-border-strong bg-surface text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Link>
          ) : null}
          <h1 className="text-lg font-bold tracking-tight text-text-primary">
            {currentPage?.title ?? "Dashboard"}
          </h1>
          {currentPage?.subtitle ? (
            <span className="group relative inline-flex">
              <button
                type="button"
                aria-label={currentPage.subtitle}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-muted hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <InfoIcon className="h-4 w-4" />
              </button>
              <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-secondary shadow-lg group-hover:block group-focus-within:block">
                {currentPage.subtitle}
              </span>
            </span>
          ) : null}
          <MetricPill />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-text-secondary">
            {now.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <CitySwitcher cities={cities} activeCityId={activeCityId} />
        </div>
      </div>
    </header>
  );
}
