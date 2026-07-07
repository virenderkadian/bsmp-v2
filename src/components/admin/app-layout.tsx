import type { ReactNode } from "react";
import { Sidebar } from "@/components/admin/sidebar";
import { TopBar } from "@/components/admin/top-bar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 print:bg-white">
      <Sidebar />
      <div className="lg:pl-72 print:pl-0">
        <TopBar />
        <main className="px-4 py-6 sm:px-6 lg:px-8 print:p-0">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 print:max-w-none print:gap-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
