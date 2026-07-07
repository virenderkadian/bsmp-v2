import { SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { BusinessProfileForm } from "@/app/settings/business-profile-form";
import { getBusinessProfile } from "@/lib/settings";

const settingsRows = [
  {
    id: "s-1",
    item: "Database mode",
    value: "Supabase session pooler",
    note: "Free-tier compatible local setup",
  },
  {
    id: "s-2",
    item: "App theme",
    value: "Dairy Admin Standard",
    note: "Dark sidebar, light workspace, blue primary actions",
  },
  {
    id: "s-3",
    item: "Offline sync",
    value: "Planned",
    note: "Deferred until daily entry is stable",
  },
];

export default async function SettingsPage() {
  const { profile } = await getBusinessProfile();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Workspace notes, configuration references, and rollout guidance."
        actions={<SecondaryButton>Review setup</SecondaryButton>}
      />

      <BusinessProfileForm profile={profile} />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Environment notes</h2>
            <p className="mt-1 text-sm text-slate-500">
              Shared admin guidance so future pages stay visually and operationally consistent.
            </p>
          </div>
          <StatusBadge tone="info">Standardized</StatusBadge>
        </div>
        <DataTable
          columns={["Setting", "Value", "Note"]}
          rows={settingsRows.map((row) => ({
            key: row.id,
            cells: [row.item, row.value, row.note],
          }))}
        />
      </section>
    </>
  );
}
