"use client";

import { useState } from "react";
import type { BusinessProfile } from "@prisma/client";
import { AppearancePanel } from "@/app/settings/appearance-panel";
import { BusinessProfileForm } from "@/app/settings/business-profile-form";
import { MasterTabs } from "@/components/admin/master-tabs";

type BasicSettingsTab = "profile" | "appearance";

// The non-superadmin view: no Cities/Team/Activity/Archive (those are
// workspace-wide, superadmin-only concerns), but appearance is a personal
// preference every signed-in user should be able to set for themselves.
export function BasicSettingsTabs({ profile }: { profile: BusinessProfile | null }) {
  const [activeTab, setActiveTab] = useState<BasicSettingsTab>("profile");

  return (
    <>
      <MasterTabs
        activeValue={activeTab}
        tabs={[
          { value: "profile", label: "Business profile" },
          { value: "appearance", label: "Appearance" },
        ]}
        onChange={setActiveTab}
      />

      {activeTab === "profile" ? <BusinessProfileForm profile={profile} /> : null}
      {activeTab === "appearance" ? <AppearancePanel /> : null}
    </>
  );
}
