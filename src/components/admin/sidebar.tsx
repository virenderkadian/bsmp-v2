"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { LogoutIcon, SidebarPanelIcon } from "@/components/admin/icons";
import { LoadingSpinner } from "@/components/admin/loading-spinner";
import { appNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/current-user";

function SidebarLinkStatus() {
  const { pending } = useLinkStatus();

  return (
    <span className="ml-auto inline-flex h-4 w-4 items-center justify-center">
      {pending ? <LoadingSpinner className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

function roleLabel(role: CurrentUser["role"]) {
  if (role === "SUPERADMIN") {
    return "Superadmin";
  }

  if (role === "ADMIN") {
    return "Admin";
  }

  return "User";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Sidebar({
  user,
  collapsed,
  onToggleCollapsed,
}: {
  user: CurrentUser | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 hidden flex-col border-r border-sidebar-border bg-sidebar-bg py-6 shadow-[1px_0_0_rgba(0,0,0,0.02)] transition-[width,background-color,border-color] duration-200 lg:flex print:hidden",
        collapsed ? "w-20 px-3" : "w-72 px-5",
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-sidebar-border pb-6",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {collapsed ? null : (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sidebar-text-muted">BSMP OPS V2</p>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-text-muted transition hover:bg-sidebar-hover-bg hover:text-text-primary"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <SidebarPanelIcon className="h-4 w-4" />
        </button>
      </div>

      <nav className="sidebar-nav-scroll mt-8 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1">
          {appNavigation.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.title : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  collapsed && "justify-center",
                  active
                    ? "bg-sidebar-active-bg text-accent-soft-text"
                    : "text-sidebar-text hover:translate-x-0.5 hover:bg-sidebar-hover-bg hover:text-text-primary",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-all duration-150",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-30",
                  )}
                />
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-accent" : "text-sidebar-icon-muted group-hover:text-sidebar-text",
                  )}
                />
                {collapsed ? null : <span>{item.title}</span>}
                {collapsed ? null : <SidebarLinkStatus />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-sidebar-border pt-4">
        {user ? (
          collapsed ? (
            <div
              className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-hover text-xs font-semibold text-accent-contrast shadow-sm"
              title={`${user.fullName} · ${roleLabel(user.role)}`}
            >
              {initials(user.fullName)}
            </div>
          ) : (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-sidebar-border bg-surface/70 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-hover text-xs font-semibold text-accent-contrast shadow-sm">
                {initials(user.fullName)}
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-text-primary">{user.fullName}</p>
                <p className="mt-0.5 text-xs text-sidebar-text-muted">{roleLabel(user.role)}</p>
              </div>
            </div>
          )
        ) : null}
        <button
          type="button"
          onClick={() => signOut()}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-surface/60 px-3 py-2 text-sm font-medium text-sidebar-text transition-all duration-150 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600",
            collapsed && "justify-center px-0",
          )}
        >
          <LogoutIcon className="h-4 w-4 shrink-0" />
          {collapsed ? null : "Logout"}
        </button>
      </div>
    </aside>
  );
}
