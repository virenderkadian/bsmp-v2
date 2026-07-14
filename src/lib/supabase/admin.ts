import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// SERVER-ONLY. Uses the service role key, which bypasses RLS and can manage
// every auth user in the project — never import this from a Client
// Component, and never send this key to the browser. Used only for
// superadmin actions: inviting/creating users, resetting passwords, etc.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
