"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { downloadBillAsPdf } from "@/lib/export-bill-pdf";

// Picked up when this page is reached via the customer profile's per-row
// share button (which links here with ?download=1, since that page only
// has bill summaries — no .bill-document to capture there). Fires once on
// mount, then strips the flag from the URL so a refresh doesn't re-trigger
// a second download.
export function AutoDownloadBillPdf({ shouldDownload, filename }: { shouldDownload: boolean; filename: string }) {
  const router = useRouter();
  const triggered = useRef(false);

  useEffect(() => {
    if (!shouldDownload || triggered.current) {
      return;
    }
    triggered.current = true;

    downloadBillAsPdf(filename)
      .catch(() => {
        // Silent here — the bill page itself is still fully usable, and the
        // office can fall back to the button/Print either way. Nothing to
        // show a toast against once this effect's component has no visible
        // pending state of its own.
      })
      .finally(() => {
        router.replace(window.location.pathname);
      });
  }, [shouldDownload, filename, router]);

  return null;
}
