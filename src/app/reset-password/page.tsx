import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">BSMP Ops V2</p>
        <h1 className="mt-1 text-2xl font-bold text-text-primary">Set a new password</h1>
        <p className="mt-1 text-sm text-text-secondary">Choose a new password for your account.</p>

        <div className="mt-6">
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
