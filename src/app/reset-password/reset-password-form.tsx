"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PrimaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";

type ReadyState = "checking" | "ready" | "invalid" | "success";

// True only when the URL itself carries evidence of a fresh recovery
// attempt — a PKCE `code`, an OTP `token_hash`+`type=recovery`, or (legacy
// implicit flow) a `#access_token=...&type=recovery` fragment. This
// deliberately does NOT trust "a session already exists" on its own: this
// page is reachable by anyone who's already signed in in this browser (e.g.
// the developer, mid-testing), and treating a pre-existing session as
// recovery-ready caused a real bug — updateUser() ran against that stale
// session right as the real recovery exchange was rotating tokens
// underneath it, and failed.
function hasRecoveryEvidenceInUrl() {
  if (typeof window === "undefined") {
    return false;
  }

  const search = new URLSearchParams(window.location.search);
  if (search.has("code")) {
    return true;
  }

  if (search.get("type") === "recovery" && search.has("token_hash")) {
    return true;
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("type") === "recovery" && (hash.has("access_token") || hash.has("token_hash"));
}

// The reset-password link lands here carrying a one-time recovery code in
// the URL. Supabase's browser client exchanges it for a session
// automatically on load and fires a PASSWORD_RECOVERY auth event — there's
// no server-side code to run first (the code isn't readable server-side
// until the client has processed it), so this whole flow has to be a Client
// Component.
export function ResetPasswordForm() {
  const [readyState, setReadyState] = useState<ReadyState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!hasRecoveryEvidenceInUrl()) {
      // Reading window.location once on mount, not syncing derived state —
      // the case react-hooks/set-state-in-effect's own guidance carves out
      // (see the same pattern/comment in components/admin/app-layout.tsx).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReadyState("invalid");
      return;
    }

    const supabase = createClient();
    let settled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setReadyState("ready");
      }
    });

    // The client exchanges the code for a session asynchronously as part of
    // its own initialization; poll briefly rather than trusting a single
    // getSession() call, since that can resolve before the exchange lands.
    let cancelled = false;
    const pollInterval = setInterval(() => {
      if (settled || cancelled) {
        return;
      }

      supabase.auth.getSession().then(({ data }) => {
        if (!settled && !cancelled && data.session) {
          settled = true;
          setReadyState("ready");
        }
      });
    }, 300);

    const timeout = setTimeout(() => {
      if (!settled) {
        setReadyState((current) => (current === "checking" ? "invalid" : current));
      }
    }, 6000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      console.error("Password update failed:", updateError);
      setError(`Couldn't update your password: ${updateError.message}`);
      return;
    }

    setReadyState("success");
    setTimeout(() => router.push("/"), 1500);
  }

  if (readyState === "checking") {
    return <p className="text-sm text-text-secondary">Verifying your reset link...</p>;
  }

  if (readyState === "invalid") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-rose-700">
          This reset link is invalid or has expired. Request a new one below.
        </p>
        <Link href="/forgot-password" className="text-sm font-medium text-blue-700 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  if (readyState === "success") {
    return <p className="text-sm text-emerald-700">Password updated. Taking you to the app...</p>;
  }

  return (
    <KeyboardForm onSubmit={handleSubmit} className="space-y-4">
      <FormInput
        label="New password"
        name="password"
        type="password"
        placeholder="••••••••"
        autoComplete="new-password"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FormInput
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        placeholder="••••••••"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
      <PrimaryButton type="submit" disabled={submitting} className="w-full justify-center">
        {submitting ? "Updating..." : "Update password"}
      </PrimaryButton>
    </KeyboardForm>
  );
}
