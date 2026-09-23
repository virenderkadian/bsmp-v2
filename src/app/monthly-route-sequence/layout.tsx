import type { ReactNode } from "react";
import { LoadingBarProvider } from "@/components/admin/loading-bar";

// Scoped to this screen for now, same as reconciliation and customers — the
// "add customer" search in monthly-route-sequence-screen.tsx marks itself
// busy while a search is in flight via setBusy.
export default function MonthlyRouteSequenceLayout({ children }: { children: ReactNode }) {
  return <LoadingBarProvider>{children}</LoadingBarProvider>;
}
