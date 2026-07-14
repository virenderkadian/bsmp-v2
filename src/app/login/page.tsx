import { LoginForm } from "@/app/login/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">BSMP Ops V2</p>
        <h1 className="mt-1 text-2xl font-bold text-text-primary">Sign in</h1>
        <p className="mt-1 text-sm text-text-secondary">Route operations, billing, and payments.</p>

        <div className="mt-6">
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
