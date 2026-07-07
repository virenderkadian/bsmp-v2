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
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          <SecondaryButton type="button" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </SecondaryButton>
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "inline-flex h-10 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700",
              "disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400",
            )}
          >
            {pending ? "Saving..." : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
