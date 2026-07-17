"use client";

import { useActionState, useEffect } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { StatusChip } from "@/components/admin/status-chip";

export type CustomerQuickCreateState = {
  status: "idle" | "success" | "error";
  message?: string;
  customerId?: string;
};

export type CustomerQuickCreateAction = (
  prevState: CustomerQuickCreateState,
  formData: FormData,
) => Promise<CustomerQuickCreateState>;

const initialState: CustomerQuickCreateState = { status: "idle" };

export function CustomerQuickCreateDialog({
  title = "Add customer",
  description = "Create a customer record without leaving the current workflow.",
  submitLabel = "Save customer",
  open,
  dbConnected,
  defaultName = "",
  hiddenFields = [],
  action,
  onClose,
  onSuccess,
}: {
  title?: string;
  description?: string;
  submitLabel?: string;
  open: boolean;
  dbConnected: boolean;
  defaultName?: string;
  hiddenFields?: Array<{ name: string; value: string }>;
  action: CustomerQuickCreateAction;
  onClose: () => void;
  onSuccess?: (state: CustomerQuickCreateState) => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (open && state.status === "success") {
      onSuccess?.(state);
      onClose();
    }
  }, [onClose, onSuccess, open, state]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={null}
    >
      <KeyboardForm action={formAction} className="space-y-4">
        {hiddenFields.map((field) => (
          <input key={field.name} type="hidden" name={field.name} value={field.value} readOnly />
        ))}

        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Name" name="name" placeholder="Customer name" defaultValue={defaultName} autoFocus />
          <FormInput label="Area" name="area" placeholder="Area / sector" />
          <FormInput label="Mobile" name="mobile" placeholder="Mobile number" />
          <div className="md:col-span-2">
            <FormInput
              label="Opening balance"
              name="openingBalance"
              type="number"
              step="0.01"
              min="0"
              defaultValue="0"
            />
          </div>
        </div>

        {state.status !== "idle" && state.message ? (
          <p className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>
            {state.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <StatusChip tone={dbConnected ? "success" : "warning"}>
            {dbConnected ? "Live data" : "Offline fallback"}
          </StatusChip>
          <SecondaryButton type="button" onClick={onClose} disabled={pending}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : submitLabel}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}
