"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";

export type ForgotPasswordState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: ForgotPasswordState = { status: "idle" };

const schema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Always returns the same success message whether or not the email belongs
// to a real account — otherwise the response itself becomes a way to check
// which emails have accounts here.
const GENERIC_SUCCESS_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

export async function requestPasswordReset(
  _prevState: ForgotPasswordState = idleState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  void _prevState;

  const parsed = schema.safeParse({ email: getValue(formData, "email") });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const siteUrl = await getSiteUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/reset-password`,
  });

  // Only surface an error for something that isn't "no such user" (Supabase
  // doesn't actually return a distinct error for that case — it always
  // reports success — but rate limiting or a misconfigured project would
  // still fail here, and that's worth surfacing).
  if (error) {
    return { status: "error", message: "Something went wrong sending the reset email. Please try again shortly." };
  }

  return { status: "success", message: GENERIC_SUCCESS_MESSAGE };
}
