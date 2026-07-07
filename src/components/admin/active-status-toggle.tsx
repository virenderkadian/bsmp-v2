"use client";

import { useActionState, useState } from "react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { PillToggle } from "@/components/admin/pill-toggle";

type ActiveStatusState = {
  status: "idle" | "success" | "error";
  message?: string;
};

type ActiveStatusAction = (
  prevState: ActiveStatusState,
  formData: FormData,
) => Promise<ActiveStatusState>;

const initialState: ActiveStatusState = { status: "idle" };

export function ActiveStatusToggle({
  id,
  name,
  isActive,
  recordLabel,
  action,
}: {
  id: string;
  name: string;
  isActive: boolean;
  recordLabel: string;
  action: ActiveStatusAction;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction, pending] = useActionState(async (prevState: ActiveStatusState, formData: FormData) => {
    const result = await action(prevState, formData);

    if (result.status === "success") {
      setConfirmOpen(false);
      setSubmitted(false);
    }

    return result;
  }, initialState);

  const nextStateLabel = isActive ? "inactive" : "active";
  const titleLabel = recordLabel.charAt(0).toUpperCase() + recordLabel.slice(1);

  const closeConfirm = () => {
    if (!pending) {
      setConfirmOpen(false);
      setSubmitted(false);
    }
  };

  return (
    <>
      <PillToggle
        active={isActive}
        pending={pending}
        onClick={() => setConfirmOpen(true)}
        aria-label={isActive ? `Make ${recordLabel} inactive` : `Activate ${recordLabel}`}
        title={isActive ? `Make ${recordLabel} inactive` : `Activate ${recordLabel}`}
      />
      <ConfirmDialog
        open={confirmOpen}
        title={isActive ? `Make ${recordLabel} inactive?` : `Activate ${recordLabel}?`}
        description={`This will mark ${name} as ${nextStateLabel}.`}
        confirmLabel={isActive ? "Make inactive" : "Activate"}
        pending={pending}
        onClose={closeConfirm}
        action={formAction}
        onSubmit={() => setSubmitted(true)}
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
        {submitted && state.status === "error" && state.message ? (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        ) : null}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {titleLabel}: <span className="font-semibold text-slate-900">{name}</span>
        </p>
      </ConfirmDialog>
    </>
  );
}
