import type { ReactNode } from "react";
import { LoadingBarProvider } from "@/components/admin/loading-bar";

// Scoped to customers for now, same as reconciliation — the bar only helps
// where the screen actually navigates through it, which here is the
// search/filter/pagination round trips in customer-screen.tsx.
export default function CustomersLayout({ children }: { children: ReactNode }) {
  return <LoadingBarProvider>{children}</LoadingBarProvider>;
}
