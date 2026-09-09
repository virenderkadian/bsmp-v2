import type { ReactNode } from "react";
import { LoadingBarProvider } from "@/components/admin/loading-bar";

// Scoped to reconciliation for now, and moves up to the app shell as each
// other module is touched — the bar only helps where the screens actually
// navigate through it.
export default function ReconciliationLayout({ children }: { children: ReactNode }) {
  return <LoadingBarProvider>{children}</LoadingBarProvider>;
}
