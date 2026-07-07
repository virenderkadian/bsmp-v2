"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SecondaryButton } from "@/components/admin/buttons";
import { SyncIcon } from "@/components/admin/icons";
import { appNavigation } from "@/lib/navigation";

export function TopBar() {
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
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-[#F8FAFC]/95 px-6 py-4 backdrop-blur print:hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
            Dairy Admin Standard
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {currentPage?.title ?? "Dashboard"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {now.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <SecondaryButton icon={<SyncIcon className="h-4 w-4" />}>
            Sync status
          </SecondaryButton>
        </div>
      </div>
    </header>
  );
}
