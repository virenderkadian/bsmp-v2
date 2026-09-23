import type { ReactNode } from "react";
import { LoadingBarProvider } from "@/components/admin/loading-bar";

// Scoped to payments for now, same as customers and monthly-route-sequence —
// the search/filter/pagination round trips in payment-screen.tsx navigate
// through it.
export default function PaymentsLayout({ children }: { children: ReactNode }) {
  return <LoadingBarProvider>{children}</LoadingBarProvider>;
}
