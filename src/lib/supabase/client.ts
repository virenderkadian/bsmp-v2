import { createBrowserClient } from "@supabase/ssr";

// For "use client" components — reads the session from cookies in the
// browser. Server Components/Actions use src/lib/supabase/server.ts instead.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
