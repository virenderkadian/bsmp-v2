"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, type LoginActionState } from "@/app/login/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";

const initialState: LoginActionState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <KeyboardForm action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormInput
        label="Email"
        name="email"
        type="email"
        placeholder="you@business.com"
        autoComplete="email"
        autoFocus
      />
      <div className="space-y-1.5">
        <FormInput
          label="Password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
        />
        <div className="text-right">
          <Link href="/forgot-password" className="text-sm font-medium text-blue-700 hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
      {state.status === "error" && state.message ? (
        <p className="text-sm font-medium text-rose-700">{state.message}</p>
      ) : null}
      <PrimaryButton type="submit" disabled={pending} className="w-full justify-center">
        {pending ? "Signing in..." : "Sign in"}
      </PrimaryButton>
    </KeyboardForm>
  );
}
