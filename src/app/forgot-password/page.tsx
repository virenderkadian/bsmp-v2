import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">BSMP Ops V2</p>
        <h1 className="mt-1 text-2xl font-bold text-text-primary">Reset your password</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Enter your account email and we&apos;ll send you a link to set a new password.
        </p>

        <div className="mt-6">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
