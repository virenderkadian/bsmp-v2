"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { updateCustomerLocation, type CustomerLocationActionState } from "@/app/customers/map/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { EmptyState } from "@/components/admin/empty-state";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { CustomerMapPayload, CustomerMapPin } from "@/lib/customer-map";

// Leaflet reaches for `window` as it loads, so it can never run during server
// rendering. Loading it dynamically is what keeps this page renderable at all.
const CustomerMapCanvas = dynamic(
  () => import("@/app/customers/map/customer-map-canvas").then((mod) => mod.CustomerMapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-surface-border bg-surface-muted text-sm text-text-secondary">
        Loading map…
      </div>
    ),
  },
);

const initialState: CustomerLocationActionState = { status: "idle" };

type LocationFilter = "all" | "located" | "missing" | "outliers";

export function CustomerMapScreen({ payload }: { payload: CustomerMapPayload }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [selected, setSelected] = useState<CustomerMapPin | null>(null);
  const [draft, setDraft] = useState<{ latitude: number; longitude: number } | null>(null);
  const [state, formAction, pending] = useActionState(updateCustomerLocation, initialState);

  // Route needs a round trip because it depends on the monthly sequence;
  // everything else filters here, which keeps typing responsive.
  const goToRoute = (routeId: string) => {
    const params = new URLSearchParams();
    if (routeId) params.set("routeId", routeId);
    params.set("month", payload.selectedMonth);
    router.push(`/customers/map?${params.toString()}`);
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return payload.pins.filter((pin) => {
      if (area === "__none__" ? Boolean(pin.area) : area && pin.area !== area) {
        return false;
      }
      if (locationFilter === "located" && pin.latitude === null) return false;
      if (locationFilter === "missing" && pin.latitude !== null) return false;
      if (locationFilter === "outliers" && pin.outlierKm === null) return false;
      if (!query) return true;

      return (
        pin.code.toLowerCase().includes(query) ||
        pin.name.toLowerCase().includes(query) ||
        (pin.area?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [payload.pins, search, area, locationFilter]);

  const mapped = filtered.filter((pin) => pin.latitude !== null && pin.longitude !== null);
  // A selected customer with no stored position is being PLACED rather than
  // corrected — there's no pin to drag, so the map takes a click instead.
  const placing = selected !== null && selected.latitude === null;

  if (!payload.dbConnected) {
    return <EmptyState message={payload.error ?? "Unable to load the customer map."} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-surface px-4 py-3">
        <SelectInput
          value={payload.selectedRouteId}
          onChange={(event) => goToRoute(event.target.value)}
          placeholder="All routes"
          options={payload.routes.map((route) => ({ value: route.id, label: `${route.code} - ${route.name}` }))}
          className="h-10 w-56 rounded-md bg-surface text-sm"
        />

        <SelectInput
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="All areas"
          options={[
            // More than half of all customers have no area at all, so this has
            // to be selectable rather than silently lumped into "all".
            { value: "__none__", label: "(No area set)" },
            ...payload.areas.map((value) => ({ value, label: value })),
          ]}
          className="h-10 w-48 rounded-md bg-surface text-sm"
        />

        <div className="flex overflow-hidden rounded-md border border-surface-border-strong">
          {(
            [
              ["all", `All ${payload.counts.total}`],
              ["located", `Mapped ${payload.counts.located}`],
              ["missing", `Missing ${payload.counts.missing}`],
              ["outliers", `Check ${payload.counts.outliers}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setLocationFilter(value)}
              className={`px-3 py-2 text-xs font-semibold transition ${
                locationFilter === value
                  ? "bg-accent text-white"
                  : "bg-surface text-text-secondary hover:bg-surface-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-w-[200px] flex-1">
          <SearchInput
            name="search"
            placeholder="Search code, name, or area"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10"
          />
        </div>
      </div>

      {payload.counts.outliers > 0 && locationFilter !== "outliers" ? (
        <button
          type="button"
          onClick={() => setLocationFilter("outliers")}
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900"
        >
          <span className="font-semibold">
            {payload.counts.outliers} location{payload.counts.outliers === 1 ? "" : "s"} look wrong.
          </span>{" "}
          Captured well away from the rest of their route — likely fixed from the vehicle rather than the door. Click
          to review.
        </button>
      ) : null}

      {state.status !== "idle" && state.message ? (
        <p className={state.status === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <CustomerMapCanvas
          pins={mapped}
          centre={payload.centre}
          selectedId={selected?.customerId ?? null}
          draft={draft}
          placing={placing}
          onSelect={(pin) => {
            setSelected(pin);
            setDraft(null);
          }}
          onDraftMove={(latitude, longitude) => setDraft({ latitude, longitude })}
        />

        <aside className="space-y-3">
          {selected ? (
            <div className="rounded-lg border border-surface-border bg-surface p-4">
              <p className="text-sm font-semibold text-text-primary">{selected.name}</p>
              <p className="text-xs text-text-muted">
                {selected.code}
                {selected.area ? ` · ${selected.area}` : ""}
                {selected.routeCode ? ` · ${selected.routeCode}` : ""}
                {selected.sequenceNo ? ` · #${selected.sequenceNo}` : ""}
              </p>

              {selected.outlierKm !== null ? (
                <p className="mt-2 text-xs text-amber-800">
                  About {selected.outlierKm.toFixed(1)} km from the rest of this route.
                </p>
              ) : null}

              <p className="mt-3 text-xs text-text-secondary">
                {placing
                  ? draft
                    ? "Drag to fine-tune, then save."
                    : "This customer has no location yet. Click the map where they are."
                  : draft
                    ? "Drag the pin to the right spot, then save."
                    : "Drag its pin on the map to correct the position."}
              </p>

              <form action={formAction} className="mt-3 space-y-2">
                <input type="hidden" name="customerId" value={selected.customerId} readOnly />
                <input type="hidden" name="latitude" value={draft?.latitude ?? selected.latitude ?? ""} readOnly />
                <input type="hidden" name="longitude" value={draft?.longitude ?? selected.longitude ?? ""} readOnly />
                <div className="flex gap-2">
                  <PrimaryButton type="submit" disabled={!draft || pending}>
                    {pending ? "Saving…" : "Save location"}
                  </PrimaryButton>
                  <SecondaryButton type="button" onClick={() => setDraft(null)} disabled={!draft}>
                    Reset
                  </SecondaryButton>
                </div>
              </form>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-surface-border-strong bg-surface px-4 py-6 text-center text-sm text-text-secondary">
              Select a pin to see the customer and correct its position.
            </div>
          )}

          <div className="rounded-lg border border-surface-border bg-surface">
            <p className="border-b border-surface-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {filtered.length} customer{filtered.length === 1 ? "" : "s"}
            </p>
            <ul className="max-h-[340px] divide-y divide-surface-border overflow-auto">
              {filtered.slice(0, 200).map((pin) => (
                <li key={pin.customerId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(pin);
                      setDraft(null);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition hover:bg-surface-muted ${
                      selected?.customerId === pin.customerId ? "bg-accent/10" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-text-primary">{pin.name}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {pin.code}
                        {pin.area ? ` · ${pin.area}` : ""}
                      </span>
                    </span>
                    {pin.latitude === null ? (
                      <StatusBadge tone="neutral">No pin</StatusBadge>
                    ) : pin.outlierKm !== null ? (
                      <StatusBadge tone="warning">Check</StatusBadge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
