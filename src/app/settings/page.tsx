import { BasicSettingsTabs } from "@/app/settings/basic-settings-tabs";
import { SettingsTabs } from "@/app/settings/settings-tabs";
import { getCurrentCityId } from "@/lib/current-city";
import { getCitySettings } from "@/lib/city-settings";
import { getCurrentUser } from "@/lib/current-user";
import {
  getArchivePayload,
  getAuditLogsPayload,
  getBillingRoutesPayload,
  getDuplicateNamesPayload,
  getBusinessProfile,
  getCitiesPayload,
  getUsersPayload,
  type ArchivePayload,
  type BillingRoutesPayload,
} from "@/lib/settings";

const emptyBillingRoutesPayload: BillingRoutesPayload = {
  dbConnected: true,
  customers: [],
  selectedMonth: new Date().toISOString().slice(0, 7),
  availableMonths: [],
  readOnly: false,
};

const emptyArchivePayload: ArchivePayload = {
  dbConnected: true,
  storageConfigured: false,
  candidates: [],
  records: [],
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ billingMonth?: string }>;
}) {
  const params = await searchParams;
  const cityId = await getCurrentCityId();
  const [{ profile }, currentUser, citySettings] = await Promise.all([
    getBusinessProfile(cityId),
    getCurrentUser(),
    getCitySettings(cityId),
  ]);
  const isSuperadmin = currentUser?.role === "SUPERADMIN";

  const [
    { dbConnected: citiesConnected, cities },
    { dbConnected: usersConnected, users },
    { dbConnected: auditLogsConnected, logs: auditLogs },
    archivePayload,
    billingRoutesPayload,
    duplicateNamesPayload,
  ] = isSuperadmin
    ? await Promise.all([
        getCitiesPayload(),
        getUsersPayload(),
        getAuditLogsPayload(),
        getArchivePayload(),
        getBillingRoutesPayload({ month: params?.billingMonth }),
        getDuplicateNamesPayload(),
      ])
    : [
        { dbConnected: true, cities: [] },
        { dbConnected: true, users: [] },
        { dbConnected: true, logs: [] },
        emptyArchivePayload,
        emptyBillingRoutesPayload,
        { dbConnected: true, groups: [], unresolvableCount: 0 },
      ];

  return (
    <>
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
          billingRoutesPayload={billingRoutesPayload}
          duplicateNamesPayload={duplicateNamesPayload}
          citySettings={citySettings}
        />
      ) : (
        <BasicSettingsTabs
          profile={profile}
          citySettings={citySettings}
          canConfigure={currentUser?.role === "ADMIN"}
        />
      )}
    </>
  );
}
