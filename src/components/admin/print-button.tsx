"use client";

import { BillIcon } from "@/components/admin/icons";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700"
    >
      <BillIcon className="h-4 w-4" />
      {label}
    </button>
  );
}
