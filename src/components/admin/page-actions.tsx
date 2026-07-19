import type { ReactNode } from "react";

// Compact right-aligned action row that replaces the old PageHeader block on
// the main screens — the page title + description now live in the top bar
// (see src/components/admin/top-bar.tsx), so all that's left per screen is
// its action buttons. Renders nothing when there are no actions.
export function PageActions({ children }: { children?: ReactNode }) {
  if (!children) {
    return null;
  }

  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}
