import { PageHeader } from "@/components/admin/page-header";
import { BasicSettingsTabs } from "@/app/settings/basic-settings-tabs";
import { SettingsTabs } from "@/app/settings/settings-tabs";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import {
  getArchivePayload,
  getAuditLogsPayload,
  getBusinessProfile,
  getCitiesPayload,
  getUsersPayload,
  type ArchivePayload,
} from "@/lib/settings";

const emptyArchivePayload: ArchivePayload = {
  dbConnected: true,
  storageConfigured: false,
  candidates: [],
  records: [],
};

export default async function SettingsPage() {
  const cityId = await getCurrentCityId();
  const [{ profile }, currentUser] = await Promise.all([getBusinessProfile(cityId), getCurrentUser()]);
  const isSuperadmin = currentUser?.role === "SUPERADMIN";

  const [
    { dbConnected: citiesConnected, cities },
    { dbConnected: usersConnected, users },
    { dbConnected: auditLogsConnected, logs: auditLogs },
    archivePayload,
  ] = isSuperadmin
    ? await Promise.all([getCitiesPayload(), getUsersPayload(), getAuditLogsPayload(), getArchivePayload()])
    : [
        { dbConnected: true, cities: [] },
        { dbConnected: true, users: [] },
        { dbConnected: true, logs: [] },
        emptyArchivePayload,
      ];

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Workspace notes, configuration references, and rollout guidance."
      />

      {isSuperadmin && currentUser ? (
        <SettingsTabs
          profile={profile}
          citiesConnected={citiesConnected}
          cities={cities}
          usersConnected={usersConnected}
          users={users}
          currentUserId={currentUser.id}
          auditLogsConnected={auditLogsConnected}
          auditLogs={auditLogs}
          archivePayload={archivePayload}
        />
      ) : (
        <BasicSettingsTabs profile={profile} />
      )}
    </>
  );
}
