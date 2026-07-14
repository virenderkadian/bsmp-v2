"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginActionState = {
  status: "idle" | "error";
  message?: string;
};

const idleState: LoginActionState = { status: "idle" };

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signIn(
  _prevState: LoginActionState = idleState,
  formData: FormData,
): Promise<LoginActionState> {
  void _prevState;

  const parsed = loginSchema.safeParse({
    email: getValue(formData, "email"),
    password: getValue(formData, "password"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { status: "error", message: "Incorrect email or password." };
  }

  const next = getValue(formData, "next");
  redirect(next.startsWith("/") ? next : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
