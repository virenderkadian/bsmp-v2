"use client";

import type { FormHTMLAttributes, ReactNode } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onClose: () => void;
  action?: FormHTMLAttributes<HTMLFormElement>["action"];
  onSubmit?: FormHTMLAttributes<HTMLFormElement>["onSubmit"];
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pending = false,
  onClose,
  action,
  onSubmit,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={null}
    >
      <form action={action} onSubmit={onSubmit} className="space-y-5">
        {children}
        <div className="flex items-center justify-end gap-3 border-t border-surface-border pt-4">
          <SecondaryButton type="button" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </SecondaryButton>
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "inline-flex h-10 items-center justify-center rounded-lg border border-accent bg-accent px-4 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover",
              "disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-surface-muted disabled:text-text-muted",
            )}
          >
            {pending ? "Saving..." : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
