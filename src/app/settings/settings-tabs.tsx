"use client";

import { useState } from "react";
import type { BusinessProfile } from "@prisma/client";
import { ActivityPanel } from "@/app/settings/activity-panel";
import { AppearancePanel } from "@/app/settings/appearance-panel";
import { ArchivePanel } from "@/app/settings/archive-panel";
import { BusinessProfileForm } from "@/app/settings/business-profile-form";
import { CitiesPanel } from "@/app/settings/cities-panel";
import { TeamPanel } from "@/app/settings/team-panel";
import { MasterTabs } from "@/components/admin/master-tabs";
import type { ArchivePayload, AuditLogRecord, CityRecord, UserRecord } from "@/lib/settings";

type SettingsTab = "profile" | "appearance" | "cities" | "team" | "activity" | "archive";

export function SettingsTabs({
  profile,
  citiesConnected,
  cities,
  usersConnected,
  users,
  currentUserId,
  auditLogsConnected,
  auditLogs,
  archivePayload,
}: {
  profile: BusinessProfile | null;
  citiesConnected: boolean;
  cities: CityRecord[];
  usersConnected: boolean;
  users: UserRecord[];
  currentUserId: string;
  auditLogsConnected: boolean;
  auditLogs: AuditLogRecord[];
  archivePayload: ArchivePayload;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  return (
    <>
      <MasterTabs
        activeValue={activeTab}
        tabs={[
          { value: "profile", label: "Business profile" },
          { value: "appearance", label: "Appearance" },
          { value: "cities", label: "Cities", count: cities.length },
          { value: "team", label: "Team", count: users.length },
          { value: "activity", label: "Activity", count: auditLogs.length },
          { value: "archive", label: "Archive", count: archivePayload.candidates.length },
        ]}
        onChange={setActiveTab}
      />

      {activeTab === "profile" ? <BusinessProfileForm profile={profile} /> : null}
      {activeTab === "appearance" ? <AppearancePanel /> : null}
      {activeTab === "cities" ? <CitiesPanel dbConnected={citiesConnected} cities={cities} /> : null}
      {activeTab === "team" ? (
        <TeamPanel dbConnected={usersConnected} users={users} cities={cities} currentUserId={currentUserId} />
      ) : null}
      {activeTab === "activity" ? (
        <ActivityPanel dbConnected={auditLogsConnected} logs={auditLogs} />
      ) : null}
      {activeTab === "archive" ? <ArchivePanel payload={archivePayload} /> : null}
    </>
  );
}
