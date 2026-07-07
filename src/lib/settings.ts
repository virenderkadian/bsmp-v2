import type { BusinessProfile } from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export const BUSINESS_PROFILE_ID = "default";

export type BusinessProfilePayload = {
  dbConnected: boolean;
  profile: BusinessProfile | null;
  error?: string;
};

export async function getBusinessProfile(): Promise<BusinessProfilePayload> {
  try {
    const profile = await withDbTimeout(
      prisma.businessProfile.findUnique({ where: { id: BUSINESS_PROFILE_ID } }),
      "Business profile request",
    );

    return { dbConnected: true, profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load business profile.";

    return { dbConnected: false, profile: null, error: message };
  }
}
