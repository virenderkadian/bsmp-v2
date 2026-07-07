"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LogoutIcon } from "@/components/admin/icons";
import { SecondaryButton } from "@/components/admin/buttons";
import { LoadingSpinner } from "@/components/admin/loading-spinner";
import { appNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

function SidebarLinkStatus() {
  const { pending } = useLinkStatus();

  return (
    <span className="ml-auto inline-flex h-4 w-4 items-center justify-center">
      {pending ? <LoadingSpinner className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-800 bg-[#0F172A] px-5 py-6 lg:flex lg:flex-col print:hidden">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">BSMP OPS V2</p>
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1.5">
        {appNavigation.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                active ? "bg-slate-800 text-blue-400" : "text-slate-300 hover:bg-slate-800/80 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.title}</span>
              <SidebarLinkStatus />
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 pt-4">
        <div className="mb-3 rounded-lg bg-slate-800/70 p-3 text-sm text-slate-300">
          Workspace mode: delivery operations
        </div>
        <SecondaryButton
          className="w-full border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          icon={<LogoutIcon className="h-4 w-4" />}
        >
          Logout
        </SecondaryButton>
      </div>
    </aside>
  );
}
