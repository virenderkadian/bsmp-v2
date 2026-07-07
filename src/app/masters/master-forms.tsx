"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import type {
  CustomerRecord,
  ProductRecord,
  RouteRecord,
  VehicleRecord,
} from "@/lib/masters";
import {
  createCustomer,
  createProduct,
  createRoute,
  createVehicle,
  type ActionState,
  updateCustomer,
  updateProduct,
  updateRoute,
  updateVehicle,
} from "@/app/masters/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";

const initialState: ActionState = { status: "idle" };

function FormStateNote({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      className={`mt-3 text-xs leading-5 ${
        state.status === "success" ? "text-emerald-700" : "text-rose-700"
      }`}
    >
      {state.message}
    </p>
  );
}

function FormCard({
  title,
  caption,
  badge,
  children,
}: {
  title: string;
  caption: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{caption}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function ProductVehicleForms({
  dbConnected,
  products,
  vehicles,
}: {
  dbConnected: boolean;
  products: ProductRecord[];
  vehicles: VehicleRecord[];
}) {
  const [productState, productAction, productPending] = useActionState(
    createProduct,
    initialState,
  );
  const [productUpdateState, productUpdateAction, productUpdatePending] = useActionState(
    updateProduct,
    initialState,
  );
  const [vehicleState, vehicleAction, vehiclePending] = useActionState(
    createVehicle,
    initialState,
  );
  const [vehicleUpdateState, vehicleUpdateAction, vehicleUpdatePending] = useActionState(
    updateVehicle,
    initialState,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="xl:col-span-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-7 text-slate-500">
        {dbConnected
          ? "Product and vehicle records will be saved directly to the live database."
          : "The database fallback is active, so form submissions may not persist until the connection is available."}
      </div>

      <FormCard
        title="Create product"
        caption="Maintain the pricing catalog used by assignments, daily entry, and billing."
        badge={<StatusBadge tone={dbConnected ? "success" : "warning"}>{dbConnected ? "Live" : "Fallback"}</StatusBadge>}
      >
        <form action={productAction} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="BM-500" />
            <FormInput label="Name" name="name" placeholder="Buffalo Milk 500ml" />
            <FormInput label="Unit" name="unit" placeholder="Litre" />
            <FormInput
              label="Default rate"
              name="defaultRate"
              type="number"
              placeholder="34"
            />
          </div>
          <PrimaryButton type="submit" disabled={productPending}>
            {productPending ? "Saving..." : "Add product"}
          </PrimaryButton>
          <FormStateNote state={productState} />
        </form>
      </FormCard>

      <FormCard
        title="Create vehicle"
        caption="Keep supporting fleet data accurate for route allocation and reconciliation."
      >
        <form action={vehicleAction} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="VH-04" />
            <FormInput label="Name" name="name" placeholder="Delivery Van 4" />
            <div className="md:col-span-2">
              <FormInput
                label="Registration"
                name="registration"
                placeholder="RJ14 XX 4411"
              />
            </div>
          </div>
          <PrimaryButton type="submit" disabled={vehiclePending}>
            {vehiclePending ? "Saving..." : "Add vehicle"}
          </PrimaryButton>
          <FormStateNote state={vehicleState} />
        </form>
      </FormCard>

      <FormCard
        title="Update product"
        caption="Edit an existing product code, label, unit, or default rate."
      >
        <form action={productUpdateAction} className="mt-5 space-y-4">
          <SelectInput
            label="Product"
            name="id"
            defaultValue={products[0]?.id ?? ""}
            placeholder="Select product"
            options={products.map((product) => ({
              value: product.id,
              label: `${product.code} - ${product.name}`,
            }))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="BM-500" />
            <FormInput label="Name" name="name" placeholder="Buffalo Milk 500ml" />
            <FormInput label="Unit" name="unit" placeholder="Litre" />
            <FormInput
              label="Default rate"
              name="defaultRate"
              type="number"
              placeholder="34"
            />
          </div>
          <PrimaryButton type="submit" disabled={productUpdatePending || products.length === 0}>
            {productUpdatePending ? "Saving..." : "Update product"}
          </PrimaryButton>
          <FormStateNote state={productUpdateState} />
        </form>
      </FormCard>

      <FormCard
        title="Update vehicle"
        caption="Edit an existing vehicle after route allocation or registration changes."
      >
        <form action={vehicleUpdateAction} className="mt-5 space-y-4">
          <SelectInput
            label="Vehicle"
            name="id"
            defaultValue={vehicles[0]?.id ?? ""}
            placeholder="Select vehicle"
            options={vehicles.map((vehicle) => ({
              value: vehicle.id,
              label: `${vehicle.code} - ${vehicle.name}`,
            }))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="VH-04" />
            <FormInput label="Name" name="name" placeholder="Delivery Van 4" />
            <div className="md:col-span-2">
              <FormInput
                label="Registration"
                name="registration"
                placeholder="RJ14 XX 4411"
              />
            </div>
          </div>
          <PrimaryButton type="submit" disabled={vehicleUpdatePending || vehicles.length === 0}>
            {vehicleUpdatePending ? "Saving..." : "Update vehicle"}
          </PrimaryButton>
          <FormStateNote state={vehicleUpdateState} />
        </form>
      </FormCard>
    </div>
  );
}

export function RouteCreateForm({
  dbConnected,
  vehicles,
  routes,
}: {
  dbConnected: boolean;
  vehicles: VehicleRecord[];
  routes: RouteRecord[];
}) {
  const [routeState, routeAction, routePending] = useActionState(createRoute, initialState);
  const [routeUpdateState, routeUpdateAction, routeUpdatePending] = useActionState(
    updateRoute,
    initialState,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <FormCard
        title="Create route"
        caption="Add a route master before attaching customers and default delivery packets."
        badge={<StatusBadge tone={dbConnected ? "success" : "warning"}>{dbConnected ? "Live" : "Fallback"}</StatusBadge>}
      >
        <form action={routeAction} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="RT-M-03" />
            <FormInput label="Route name" name="name" placeholder="Pratap Nagar Morning" />
            <SelectInput
              label="Shift"
              name="shift"
              defaultValue="MORNING"
              options={[
                { value: "MORNING", label: "Morning" },
                { value: "EVENING", label: "Evening" },
              ]}
            />
            <SelectInput
              label="Vehicle"
              name="vehicleId"
              defaultValue=""
              placeholder="Unassigned for now"
              options={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: `${vehicle.code} - ${vehicle.name}`,
              }))}
            />
          </div>
          <PrimaryButton type="submit" disabled={routePending}>
            {routePending ? "Saving..." : "Add route"}
          </PrimaryButton>
          <FormStateNote state={routeState} />
        </form>
      </FormCard>

      <FormCard
        title="Update route"
        caption="Edit route naming, shift, or vehicle assignment."
      >
        <form action={routeUpdateAction} className="mt-5 space-y-4">
          <SelectInput
            label="Route"
            name="id"
            defaultValue={routes[0]?.id ?? ""}
            placeholder="Select route"
            options={routes.map((route) => ({
              value: route.id,
              label: `${route.code} - ${route.name}`,
            }))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="RT-M-03" />
            <FormInput label="Route name" name="name" placeholder="Pratap Nagar Morning" />
            <SelectInput
              label="Shift"
              name="shift"
              defaultValue="MORNING"
              options={[
                { value: "MORNING", label: "Morning" },
                { value: "EVENING", label: "Evening" },
              ]}
            />
            <SelectInput
              label="Vehicle"
              name="vehicleId"
              defaultValue=""
              placeholder="Unassigned for now"
              options={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: `${vehicle.code} - ${vehicle.name}`,
              }))}
            />
          </div>
          <PrimaryButton type="submit" disabled={routeUpdatePending || routes.length === 0}>
            {routeUpdatePending ? "Saving..." : "Update route"}
          </PrimaryButton>
          <FormStateNote state={routeUpdateState} />
        </form>
      </FormCard>
    </div>
  );
}

export function CustomerCreateForm({
  dbConnected,
  customers,
}: {
  dbConnected: boolean;
  customers: CustomerRecord[];
}) {
  const [customerState, customerAction, customerPending] = useActionState(
    createCustomer,
    initialState,
  );
  const [customerUpdateState, customerUpdateAction, customerUpdatePending] = useActionState(
    updateCustomer,
    initialState,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <FormCard
        title="Create customer"
        caption="Add customer records with clean operational data before routing, payments, and billing."
        badge={<StatusBadge tone={dbConnected ? "success" : "warning"}>{dbConnected ? "Live" : "Fallback"}</StatusBadge>}
      >
        <form action={customerAction} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="CUS-104" />
            <FormInput label="Name" name="name" placeholder="Deepak Meena" />
            <FormInput label="Area" name="area" placeholder="Mansarovar" />
            <FormInput label="Mobile" name="mobile" placeholder="98290 11224" />
            <div className="md:col-span-2">
              <FormInput
                label="Opening balance"
                name="openingBalance"
                type="number"
                placeholder="0"
                defaultValue="0"
              />
            </div>
          </div>
          <PrimaryButton type="submit" disabled={customerPending}>
            {customerPending ? "Saving..." : "Add customer"}
          </PrimaryButton>
          <FormStateNote state={customerState} />
        </form>
      </FormCard>

      <FormCard
        title="Update customer"
        caption="Edit customer identity, area, contact number, or opening balance."
      >
        <form action={customerUpdateAction} className="mt-5 space-y-4">
          <SelectInput
            label="Customer"
            name="id"
            defaultValue={customers[0]?.id ?? ""}
            placeholder="Select customer"
            options={customers.map((customer) => ({
              value: customer.id,
              label: `${customer.code} - ${customer.name}`,
            }))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Code" name="code" placeholder="CUS-104" />
            <FormInput label="Name" name="name" placeholder="Deepak Meena" />
            <FormInput label="Area" name="area" placeholder="Mansarovar" />
            <FormInput label="Mobile" name="mobile" placeholder="98290 11224" />
            <div className="md:col-span-2">
              <FormInput
                label="Opening balance"
                name="openingBalance"
                type="number"
                placeholder="0"
              />
            </div>
          </div>
          <PrimaryButton type="submit" disabled={customerUpdatePending || customers.length === 0}>
            {customerUpdatePending ? "Saving..." : "Update customer"}
          </PrimaryButton>
          <FormStateNote state={customerUpdateState} />
        </form>
      </FormCard>
    </div>
  );
}
