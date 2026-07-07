"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BUSINESS_PROFILE_ID } from "@/lib/settings";
import { generateUpiQrDataUrl } from "@/lib/upi-qr";

export type SettingsActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: SettingsActionState = { status: "idle" };

const businessProfileSchema = z.object({
  businessName: z.string().trim().min(2, "Business name is required."),
  contactPhone: z.string().trim().optional(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  bankAccountName: z.string().trim().optional(),
  bankAccountNumber: z.string().trim().optional(),
  bankIfsc: z.string().trim().optional(),
  bankName: z.string().trim().optional(),
  upiId: z.string().trim().optional(),
  footerNote: z.string().trim().optional(),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function asNullable(value: string | undefined) {
  return value && value.trim() !== "" ? value.trim() : null;
}

export async function updateBusinessProfile(
  _prevState: SettingsActionState = idleState,
  formData: FormData,
): Promise<SettingsActionState> {
  void _prevState;

  const parsed = businessProfileSchema.safeParse({
    businessName: getValue(formData, "businessName"),
    contactPhone: getValue(formData, "contactPhone"),
    addressLine1: getValue(formData, "addressLine1"),
    addressLine2: getValue(formData, "addressLine2"),
    bankAccountName: getValue(formData, "bankAccountName"),
    bankAccountNumber: getValue(formData, "bankAccountNumber"),
    bankIfsc: getValue(formData, "bankIfsc"),
    bankName: getValue(formData, "bankName"),
    upiId: getValue(formData, "upiId"),
    footerNote: getValue(formData, "footerNote"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  try {
    const upiId = asNullable(parsed.data.upiId);
    // Regenerated only here, on save — not on every bill view/print.
    const upiQrDataUrl = upiId ? await generateUpiQrDataUrl(upiId, parsed.data.businessName) : null;

    await prisma.businessProfile.upsert({
      where: { id: BUSINESS_PROFILE_ID },
      update: {
        businessName: parsed.data.businessName,
        contactPhone: asNullable(parsed.data.contactPhone),
        addressLine1: asNullable(parsed.data.addressLine1),
        addressLine2: asNullable(parsed.data.addressLine2),
        bankAccountName: asNullable(parsed.data.bankAccountName),
        bankAccountNumber: asNullable(parsed.data.bankAccountNumber),
        bankIfsc: asNullable(parsed.data.bankIfsc),
        bankName: asNullable(parsed.data.bankName),
        upiId,
        upiQrDataUrl,
        footerNote: asNullable(parsed.data.footerNote),
      },
      create: {
        id: BUSINESS_PROFILE_ID,
        businessName: parsed.data.businessName,
        contactPhone: asNullable(parsed.data.contactPhone),
        addressLine1: asNullable(parsed.data.addressLine1),
        addressLine2: asNullable(parsed.data.addressLine2),
        bankAccountName: asNullable(parsed.data.bankAccountName),
        bankAccountNumber: asNullable(parsed.data.bankAccountNumber),
        bankIfsc: asNullable(parsed.data.bankIfsc),
        bankName: asNullable(parsed.data.bankName),
        upiId,
        upiQrDataUrl,
        footerNote: asNullable(parsed.data.footerNote),
      },
    });

    revalidatePath("/settings");
    revalidatePath("/monthly-bills");

    return { status: "success", message: "Business profile updated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";

    return { status: "error", message };
  }
}
