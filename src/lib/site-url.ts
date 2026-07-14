import "server-only";
import { headers } from "next/headers";

// Used to build the redirectTo URL for Supabase's password-reset email —
// this must match an entry in Supabase Dashboard > Authentication > URL
// Configuration > Redirect URLs, or the email link falls back to the
// project's default Site URL instead of landing back in this app. Prefers an
// explicit env var (needed once this deploys somewhere with a domain) and
// falls back to the request's own Host header, which is already correct for
// local dev.
export async function getSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";

  return `${protocol}://${host}`;
}
