"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  createRoute,
  createVehicle,
  setRouteActiveState,
  setVehicleActiveState,
  type ActionState,
  updateRoute,
  updateVehicle,
} from "@/app/masters/actions";
import { ActiveStatusToggle } from "@/components/admin/active-status-toggle";
import { ActionButton, PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { EditIcon, PlusIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { MasterTabs } from "@/components/admin/master-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { RouteRecord, VehicleRecord } from "@/lib/masters";

const initialState: ActionState = { status: "idle" };

type RouteScreenProps = {
  dbConnected: boolean;
  routes: RouteRecord[];
  vehicles: VehicleRecord[];
};

type MasterTab = "routes" | "vehicles";

type RouteDraft = {
  id?: string;
  code: string;
  name: string;
  shift: "MORNING" | "EVENING";
  vehicleId: string;
  driverName: string;
  driverPhone: string;
};

type VehicleDraft = {
  id?: string;
  code: string;
  name: string;
  registration: string;
};

const emptyRouteDraft: RouteDraft = {
  code: "",
  name: "",
  shift: "MORNING",
  vehicleId: "",
  driverName: "",
  driverPhone: "",
};

const emptyVehicleDraft: VehicleDraft = {
  code: "",
  name: "",
  registration: "",
};

function RouteDialog({
  open,
  mode,
  dbConnected,
  draft,
  vehicles,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  dbConnected: boolean;
  draft: RouteDraft;
  vehicles: VehicleRecord[];
  onClose: () => void;
}) {
  const [createState, createAction, createPending] = useActionState(createRoute, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateRoute, initialState);
  const state = mode === "create" ? createState : updateState;
  const pending = mode === "create" ? createPending : updatePending;

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add route" : "Edit route"}
      description="Maintain route master records used by daily entry and monthly sequence."
      footer={null}
    >
      <KeyboardForm action={mode === "create" ? createAction : updateAction} className="space-y-4">
        {mode === "edit" && draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Code" name="code" placeholder="RT-M-03" defaultValue={draft.code} autoFocus />
          <FormInput label="Route name" name="name" placeholder="Pratap Nagar Morning" defaultValue={draft.name} />
          <SelectInput
            label="Shift"
            name="shift"
            defaultValue={draft.shift}
            options={[
              { value: "MORNING", label: "Morning" },
              { value: "EVENING", label: "Evening" },
            ]}
          />
          <SelectInput
            label="Vehicle"
            name="vehicleId"
            defaultValue={draft.vehicleId}
            placeholder="Unassigned for now"
            options={vehicles.map((vehicle) => ({
              value: vehicle.id,
              label: `${vehicle.code} - ${vehicle.name}`,
            }))}
          />
          <FormInput
            label="Driver name"
            name="driverName"
            placeholder="Naveen"
            defaultValue={draft.driverName}
          />
          <FormInput
            label="Driver phone"
            name="driverPhone"
            placeholder="9728884817"
            defaultValue={draft.driverPhone}
          />
        </div>
        {state.status !== "idle" && state.message ? (
          <p className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <StatusBadge tone={dbConnected ? "success" : "warning"}>
            {dbConnected ? "Live data" : "Offline fallback"}
          </StatusBadge>
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : mode === "create" ? "Save route" : "Update route"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

function VehicleDialog({
  open,
  mode,
  dbConnected,
  draft,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  dbConnected: boolean;
  draft: VehicleDraft;
  onClose: () => void;
}) {
  const [createState, createAction, createPending] = useActionState(createVehicle, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateVehicle, initialState);
  const state = mode === "create" ? createState : updateState;
  const pending = mode === "create" ? createPending : updatePending;

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add vehicle" : "Edit vehicle"}
      description="Maintain vehicle master records used for route assignment and reconciliation."
      footer={null}
    >
      <KeyboardForm action={mode === "create" ? createAction : updateAction} className="space-y-4">
        {mode === "edit" && draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Code" name="code" placeholder="VH-04" defaultValue={draft.code} autoFocus />
          <FormInput label="Vehicle name" name="name" placeholder="Delivery Van 4" defaultValue={draft.name} />
          <div className="md:col-span-2">
            <FormInput
              label="Registration"
              name="registration"
              placeholder="RJ14 XX 4411"
              defaultValue={draft.registration}
            />
          </div>
        </div>
        {state.status !== "idle" && state.message ? (
          <p className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <StatusBadge tone={dbConnected ? "success" : "warning"}>
            {dbConnected ? "Live data" : "Offline fallback"}
          </StatusBadge>
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : mode === "create" ? "Save vehicle" : "Update vehicle"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

function RouteTab({
  dbConnected,
  routes,
  vehicles,
  onEditRoute,
}: {
  dbConnected: boolean;
  routes: RouteRecord[];
  vehicles: VehicleRecord[];
  onEditRoute: (routeId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [shift, setShift] = useState("");
  const [status, setStatus] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  const filteredRoutes = useMemo(() => {
    return routes.filter((route) => {
      const query = search.toLowerCase().trim();
      const matchesSearch =
        query === "" || route.code.toLowerCase().includes(query) || route.name.toLowerCase().includes(query);
      const matchesShift = shift === "" || route.shift === shift;
      const matchesStatus = status === "" || (status === "ACTIVE" ? route.isActive : !route.isActive);
      const matchesVehicle = vehicleId === "" || route.vehicleId === vehicleId;

      return matchesSearch && matchesShift && matchesStatus && matchesVehicle;
    });
  }, [routes, search, shift, status, vehicleId]);

  const hasActiveFilters = search.trim() !== "" || shift !== "" || status !== "" || vehicleId !== "";

  const resetFilters = () => {
    setSearch("");
    setShift("");
    setStatus("");
    setVehicleId("");
  };

  return (
    <>
      <section className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid w-full gap-3 md:grid-cols-[minmax(280px,1fr)_170px_180px] xl:max-w-5xl xl:grid-cols-[minmax(320px,1fr)_160px_180px_240px]">
          <SearchInput
            name="search"
            placeholder="Search route"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SelectInput
            value={shift}
            onChange={(event) => setShift(event.target.value)}
            placeholder="All shifts"
            options={[
              { value: "MORNING", label: "Morning" },
              { value: "EVENING", label: "Evening" },
            ]}
            className="h-10 rounded-md bg-surface text-sm"
          />
          <SelectInput
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="All statuses"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
            className="h-10 rounded-md bg-surface text-sm"
          />
          <SelectInput
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            placeholder="All vehicles"
            options={vehicles.map((vehicle) => ({
              value: vehicle.id,
              label: `${vehicle.code} - ${vehicle.name}`,
            }))}
            className="h-10 rounded-md bg-surface text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
          {hasActiveFilters ? (
            <SecondaryButton type="button" onClick={resetFilters} className="h-10 px-4 text-sm font-medium">
              Clear
            </SecondaryButton>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Route directory</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Showing {filteredRoutes.length} of {routes.length} routes
          </p>
        </div>
        <DataTable
          columns={[
            { key: "route", label: "Route" },
            { key: "shift", label: "Shift" },
            { key: "vehicle", label: "Vehicle" },
            { key: "status", label: "Status" },
            {
              key: "actions",
              label: "Actions",
              className: "text-right",
              headerClassName: "text-right",
            },
          ]}
          rows={filteredRoutes.map((route) => ({
            key: route.id,
            cells: [
              <div key="route" className="min-w-[220px]">
                <p className="text-[15px] font-semibold leading-6 text-text-primary">{route.name}</p>
                <p className="mt-0.5 text-sm text-text-secondary">{route.code}</p>
              </div>,
              <span key="shift" className="text-sm text-slate-800">
                {route.shift === "MORNING" ? "Morning" : "Evening"}
              </span>,
              <span key="vehicle" className="text-sm text-slate-800">
                {route.vehicleName ?? "-"}
              </span>,
              <ActiveStatusToggle
                key="status"
                id={route.id}
                name={route.name}
                isActive={route.isActive}
                recordLabel="route"
                action={setRouteActiveState}
              />,
              <div key="actions" className="flex justify-end">
                <ActionButton
                  type="button"
                  icon={<EditIcon className="h-[18px] w-[18px]" />}
                  className="h-8 w-8 rounded-md border-none bg-transparent px-0 text-text-primary shadow-none hover:bg-surface-muted"
                  onClick={() => onEditRoute(route.id)}
                  aria-label="Edit route"
                  title="Edit route"
                >
                  <span className="sr-only">Edit route</span>
                </ActionButton>
              </div>,
            ],
          }))}
          emptyMessage="No routes match the selected filters"
          minWidth="min-w-[820px]"
          className="rounded-md border-surface-border shadow-none"
          headClassName="bg-surface-muted/70"
          headerCellClassName="px-5 py-3"
          rowClassName="align-middle hover:bg-surface-muted/60"
          cellClassName="px-5 py-3.5"
        />
      </section>
    </>
  );
}

function VehicleTab({
  dbConnected,
  vehicles,
  onEditVehicle,
}: {
  dbConnected: boolean;
  vehicles: VehicleRecord[];
  onEditVehicle: (vehicleId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => {
      const query = search.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        vehicle.code.toLowerCase().includes(query) ||
        vehicle.name.toLowerCase().includes(query) ||
        (vehicle.registration ?? "").toLowerCase().includes(query);
      const matchesStatus = status === "" || (status === "ACTIVE" ? vehicle.isActive : !vehicle.isActive);

      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, status]);

  const hasActiveFilters = search.trim() !== "" || status !== "";

  const resetFilters = () => {
    setSearch("");
    setStatus("");
  };

  return (
    <>
      <section className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid w-full gap-3 md:grid-cols-[minmax(280px,1fr)_180px] xl:max-w-2xl">
          <SearchInput
            name="vehicleSearch"
            placeholder="Search vehicle"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SelectInput
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="All statuses"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
            className="h-10 rounded-md bg-surface text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
          {hasActiveFilters ? (
            <SecondaryButton type="button" onClick={resetFilters} className="h-10 px-4 text-sm font-medium">
              Clear
            </SecondaryButton>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Vehicle directory</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Showing {filteredVehicles.length} of {vehicles.length} vehicles
          </p>
        </div>
        <DataTable
          columns={[
            { key: "vehicle", label: "Vehicle" },
            { key: "registration", label: "Registration" },
            { key: "status", label: "Status" },
            {
              key: "actions",
              label: "Actions",
              className: "text-right",
              headerClassName: "text-right",
            },
          ]}
          rows={filteredVehicles.map((vehicle) => ({
            key: vehicle.id,
            cells: [
              <div key="vehicle" className="min-w-[220px]">
                <p className="text-[15px] font-semibold leading-6 text-text-primary">{vehicle.name}</p>
                <p className="mt-0.5 text-sm text-text-secondary">{vehicle.code}</p>
              </div>,
              <span key="registration" className="text-sm text-slate-800">
                {vehicle.registration ?? "-"}
              </span>,
              <ActiveStatusToggle
                key="status"
                id={vehicle.id}
                name={vehicle.name}
                isActive={vehicle.isActive}
                recordLabel="vehicle"
                action={setVehicleActiveState}
              />,
              <div key="actions" className="flex justify-end">
                <ActionButton
                  type="button"
                  icon={<EditIcon className="h-[18px] w-[18px]" />}
                  className="h-8 w-8 rounded-md border-none bg-transparent px-0 text-text-primary shadow-none hover:bg-surface-muted"
                  onClick={() => onEditVehicle(vehicle.id)}
                  aria-label="Edit vehicle"
                  title="Edit vehicle"
                >
                  <span className="sr-only">Edit vehicle</span>
                </ActionButton>
              </div>,
            ],
          }))}
          emptyMessage="No vehicles match the selected filters"
          minWidth="min-w-[720px]"
          className="rounded-md border-surface-border shadow-none"
          headClassName="bg-surface-muted/70"
          headerCellClassName="px-5 py-3"
          rowClassName="align-middle hover:bg-surface-muted/60"
          cellClassName="px-5 py-3.5"
        />
      </section>
    </>
  );
}

export function RouteScreen({ dbConnected, routes, vehicles }: RouteScreenProps) {
  const [activeTab, setActiveTab] = useState<MasterTab>("routes");
  const [routeDialogMode, setRouteDialogMode] = useState<"create" | "edit" | null>(null);
  const [vehicleDialogMode, setVehicleDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const selectedRoute = routes.find((route) => route.id === selectedRouteId);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);

  const routeDraft: RouteDraft = selectedRoute
    ? {
        id: selectedRoute.id,
        code: selectedRoute.code,
        name: selectedRoute.name,
        shift: selectedRoute.shift,
        vehicleId: selectedRoute.vehicleId ?? "",
        driverName: selectedRoute.driverName ?? "",
        driverPhone: selectedRoute.driverPhone ?? "",
      }
    : emptyRouteDraft;

  const vehicleDraft: VehicleDraft = selectedVehicle
    ? {
        id: selectedVehicle.id,
        code: selectedVehicle.code,
        name: selectedVehicle.name,
        registration: selectedVehicle.registration ?? "",
      }
    : emptyVehicleDraft;

  const closeRouteDialog = () => {
    setRouteDialogMode(null);
    setSelectedRouteId(null);
  };

  const closeVehicleDialog = () => {
    setVehicleDialogMode(null);
    setSelectedVehicleId(null);
  };

  const onAddRoute = () => {
    setSelectedRouteId(null);
    setRouteDialogMode("create");
  };
  const onAddVehicle = () => {
    setSelectedVehicleId(null);
    setVehicleDialogMode("create");
  };
  return (
    <>
      <MasterTabs
        className="-mt-6"
        activeValue={activeTab}
        tabs={[
          { value: "routes", label: "Routes", count: routes.length },
          { value: "vehicles", label: "Vehicles", count: vehicles.length },
        ]}
        onChange={setActiveTab}
      />
      <PageHeader
        actions={
          <PrimaryButton
            type="button"
            icon={<PlusIcon className="h-4 w-4" />}
            className="h-10 rounded-md px-5 text-sm font-semibold"
            onClick={activeTab === "routes" ? onAddRoute : onAddVehicle}
          >
            {activeTab === "routes" ? "Add route" : "Add vehicle"}
          </PrimaryButton>
        }
        title="Routes"
        subtitle="Manage route and vehicle masters used across delivery operations."
      />

      {activeTab === "routes" ? (
        <RouteTab
          dbConnected={dbConnected}
          routes={routes}
          vehicles={vehicles}
          onEditRoute={(routeId) => {
            setSelectedRouteId(routeId);
            setRouteDialogMode("edit");
          }}
        />
      ) : (
        <VehicleTab
          dbConnected={dbConnected}
          vehicles={vehicles}
          onEditVehicle={(vehicleId) => {
            setSelectedVehicleId(vehicleId);
            setVehicleDialogMode("edit");
          }}
        />
      )}

      {routeDialogMode ? (
        <RouteDialog
          open
          mode={routeDialogMode}
          dbConnected={dbConnected}
          draft={routeDialogMode === "edit" ? routeDraft : emptyRouteDraft}
          vehicles={vehicles}
          onClose={closeRouteDialog}
        />
      ) : null}

      {vehicleDialogMode ? (
        <VehicleDialog
          open
          mode={vehicleDialogMode}
          dbConnected={dbConnected}
          draft={vehicleDialogMode === "edit" ? vehicleDraft : emptyVehicleDraft}
          onClose={closeVehicleDialog}
        />
      ) : null}
    </>
  );
}
