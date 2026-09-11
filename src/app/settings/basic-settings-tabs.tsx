"use client";

import { useState } from "react";
import type { BusinessProfile } from "@prisma/client";
import { AppearancePanel } from "@/app/settings/appearance-panel";
import { BusinessProfileForm } from "@/app/settings/business-profile-form";
import { ConfigurationPanel } from "@/app/settings/configuration-panel";
import type { CitySettings } from "@/lib/city-settings.shared";
import { SettingsLayout, SettingsNav } from "@/components/admin/settings-nav";

type BasicSettingsTab = "profile" | "appearance" | "configuration";

// The non-superadmin view: no Cities/Team/Activity/Archive (those are
// workspace-wide, superadmin-only concerns), but appearance is a personal
// preference every signed-in user should be able to set for themselves.
export function BasicSettingsTabs({
  profile,
  citySettings,
  canConfigure,
}: {
  profile: BusinessProfile | null;
  citySettings: CitySettings;
  // Configuration changes what customers are handed, so it sits with the other
  // money-affecting actions an admin owns and a plain user does not.
  canConfigure: boolean;
}) {
  const [activeTab, setActiveTab] = useState<BasicSettingsTab>("profile");

  return (
    <SettingsLayout
      nav={
        <SettingsNav
          activeValue={activeTab}
          onChange={setActiveTab}
          groups={[
            {
              heading: "Business",
              items: [
                { value: "profile" as BasicSettingsTab, label: "Business profile" },
                ...(canConfigure
                  ? [{ value: "configuration" as BasicSettingsTab, label: "Configuration" }]
                  : []),
                { value: "appearance" as BasicSettingsTab, label: "Appearance" },
              ],
            },
          ]}
        />
      }
    >
      {activeTab === "profile" ? <BusinessProfileForm profile={profile} /> : null}
      {activeTab === "appearance" ? <AppearancePanel /> : null}
      {activeTab === "configuration" && canConfigure ? (
        <ConfigurationPanel settings={citySettings} />
      ) : null}
    </SettingsLayout>
  );
}
