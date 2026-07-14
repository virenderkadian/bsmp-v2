"use client";

import type { BusinessProfile } from "@prisma/client";
import { useActionState } from "react";
import { updateBusinessProfile, type SettingsActionState } from "@/app/settings/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { FormTextarea } from "@/components/admin/form-textarea";

const initialState: SettingsActionState = { status: "idle" };

export function BusinessProfileForm({ profile }: { profile: BusinessProfile | null }) {
  const [state, action, pending] = useActionState(updateBusinessProfile, initialState);

  return (
    <section className="rounded-xl border border-surface-border bg-surface p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Business profile</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Letterhead, bank details, and the reminder footer shown on every printed customer bill.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput
            label="Business name"
            name="businessName"
            placeholder="Bhramshakti Milk Product"
            defaultValue={profile?.businessName ?? ""}
          />
          <FormInput
            label="Contact phone"
            name="contactPhone"
            placeholder="9588514344"
            defaultValue={profile?.contactPhone ?? ""}
          />
          <FormInput
            label="Address line 1"
            name="addressLine1"
            placeholder="Sunarian Bypass Rohtak"
            defaultValue={profile?.addressLine1 ?? ""}
          />
          <FormInput
            label="Address line 2"
            name="addressLine2"
            placeholder="Optional"
            defaultValue={profile?.addressLine2 ?? ""}
          />
        </div>

        <div className="border-t border-surface-border pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Bank &amp; UPI details
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput
              label="Account name"
              name="bankAccountName"
              placeholder="Bhramshakti Milk Product"
              defaultValue={profile?.bankAccountName ?? ""}
            />
            <FormInput
              label="Account number"
              name="bankAccountNumber"
              placeholder="209588514344"
              defaultValue={profile?.bankAccountNumber ?? ""}
            />
            <FormInput
              label="IFSC"
              name="bankIfsc"
              placeholder="ESFB0011004"
              defaultValue={profile?.bankIfsc ?? ""}
            />
            <FormInput
              label="Bank name"
              name="bankName"
              placeholder="Equitas Bank"
              defaultValue={profile?.bankName ?? ""}
            />
            <FormInput
              label="UPI ID"
              name="upiId"
              placeholder="business@bank"
              defaultValue={profile?.upiId ?? ""}
            />
          </div>
        </div>

        <div className="border-t border-surface-border pt-4">
          <FormTextarea
            label="Bill footer note"
            name="footerNote"
            placeholder="Payment reminder shown at the bottom of every printed bill"
            rows={3}
            defaultValue={profile?.footerNote ?? ""}
          />
        </div>

        {state.status !== "idle" && state.message ? (
          <p className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>
            {state.message}
          </p>
        ) : null}

        <div className="flex justify-end border-t border-surface-border pt-4">
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save business profile"}
          </PrimaryButton>
        </div>
      </form>
    </section>
  );
}
