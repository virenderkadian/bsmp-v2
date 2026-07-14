import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// For Server Components, Server Actions, and Route Handlers — reads/writes
// the session via Next.js's cookie store. Session refresh on GET requests is
// handled by middleware.ts, not here.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component render, where cookies can't be
            // written — safe to ignore as long as middleware.ts is refreshing
            // the session on every request.
          }
        },
      },
    },
  );
}
