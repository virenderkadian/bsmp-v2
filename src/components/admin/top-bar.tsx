"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AccessibleCity } from "@/app/layout";
import { setActiveCity } from "@/app/session-actions";
import { appNavigation } from "@/lib/navigation";

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
    () => appNavigation.find((item) => item.href === pathname),
    [pathname],
  );

  return (
    <header className="sticky top-0 z-20 border-b border-surface-border bg-app-bg/95 px-6 py-4 backdrop-blur transition-colors duration-200 print:hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-secondary">
            Dairy Admin Standard
          </p>
          <p className="mt-1 text-sm font-semibold text-text-primary">
            {currentPage?.title ?? "Dashboard"}
          </p>
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
