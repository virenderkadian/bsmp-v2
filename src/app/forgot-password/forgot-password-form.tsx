"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/forgot-password/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";

const initialState: ForgotPasswordState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-emerald-700">{state.message}</p>
        <Link href="/login" className="text-sm font-medium text-blue-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <KeyboardForm action={action} className="space-y-4">
      <FormInput
        label="Email"
        name="email"
        type="email"
        placeholder="you@business.com"
        autoComplete="email"
        autoFocus
      />
      {state.status === "error" && state.message ? (
        <p className="text-sm font-medium text-rose-700">{state.message}</p>
      ) : null}
      <PrimaryButton type="submit" disabled={pending} className="w-full justify-center">
        {pending ? "Sending..." : "Send reset link"}
      </PrimaryButton>
      <Link href="/login" className="block text-center text-sm font-medium text-text-secondary hover:text-text-primary">
        Back to sign in
      </Link>
    </KeyboardForm>
  );
}
