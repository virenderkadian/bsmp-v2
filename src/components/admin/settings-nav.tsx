"use client";

import { cn } from "@/lib/utils";

// Settings navigation, grouped.
//
// The pill bar this replaces was a single non-wrapping row, which was fine at
// four entries and overflowed at nine. A settings screen only ever grows, so
// this is a sidebar on wide screens and a scrollable row on narrow ones —
// either way it takes another entry without anything having to be rethought.
//
// The groups are not decoration: they say which of these are about the
// business, who can get in, the data itself, and the system's own record of
// what happened.

export type SettingsNavItem<TValue extends string> = {
  value: TValue;
  label: string;
  count?: number;
};

export type SettingsNavGroup<TValue extends string> = {
  heading: string;
  items: Array<SettingsNavItem<TValue>>;
};

export function SettingsNav<TValue extends string>({
  groups,
  activeValue,
  onChange,
}: {
  groups: Array<SettingsNavGroup<TValue>>;
  activeValue: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="shrink-0 lg:w-56 lg:border-r lg:border-surface-border lg:pr-4"
    >
      {/* Narrow screens get one scrolling row with the group headings inline;
          wide screens get the stacked sidebar. */}
      <div className="flex gap-5 overflow-x-auto pb-2 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0">
        {groups.map((group) => (
          <div key={group.heading} className="shrink-0">
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
              {group.heading}
            </p>
            <div className="flex gap-1 lg:flex-col">
              {group.items.map((item) => {
                const isActive = activeValue === item.value;

                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => onChange(item.value)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition lg:w-full",
                      isActive
                        ? "bg-accent-soft text-accent-soft-text"
                        : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                    )}
                  >
                    <span className="lg:flex-1 lg:text-left">{item.label}</span>
                    {typeof item.count === "number" ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                          isActive
                            ? "bg-surface text-accent-soft-text"
                            : "bg-surface-border text-text-secondary",
                        )}
                      >
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function SettingsLayout({
  nav,
  children,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
      {nav}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
