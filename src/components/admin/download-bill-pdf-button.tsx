"use client";

import { useState } from "react";
import { IconButton } from "@/components/admin/icon-button";
import { DownloadIcon } from "@/components/admin/icons";
import { Toast } from "@/components/admin/toast";
import { downloadBillAsPdf, BillPdfExportError } from "@/lib/export-bill-pdf";

// Modeled on PrintButton (src/components/admin/print-button.tsx), but this
// one can actually fail (html2canvas-pro capturing the live DOM is not as
// bulletproof as the browser's own print pipeline), so it carries its own
// pending/error state rather than being a bare onClick.
export function DownloadBillPdfButton({
  filename,
  label = "Share (PDF)",
  iconOnly = false,
  className,
}: {
  filename: string;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setError(null);

    try {
      await downloadBillAsPdf(filename);
    } catch (caught) {
      setError(
        caught instanceof BillPdfExportError
          ? caught.message
          : "Could not generate the PDF. Try Print → Save as PDF instead.",
      );
    } finally {
      setPending(false);
    }
  };

  if (iconOnly) {
    return (
      <>
        <IconButton
          type="button"
          onClick={handleClick}
          disabled={pending}
          title={pending ? "Generating PDF..." : "Download bill as PDF"}
          aria-label={pending ? "Generating PDF" : "Download bill as PDF"}
          className={className}
        >
          <DownloadIcon className="h-[18px] w-[18px]" />
        </IconButton>
        {error ? <Toast tone="error">{error}</Toast> : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={
          className ??
          "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        <DownloadIcon className="h-4 w-4" />
        {pending ? "Generating..." : label}
      </button>
      {error ? <Toast tone="error">{error}</Toast> : null}
    </>
  );
}
