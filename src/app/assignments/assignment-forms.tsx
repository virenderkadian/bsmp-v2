"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import type {
  AssignmentRecord,
  AssignmentCustomerRecord,
  AssignmentProductRecord,
  AssignmentRouteRecord,
} from "@/lib/assignments";
import {
  createAssignment,
  createAssignmentDefault,
  type AssignmentActionState,
  updateAssignment,
  updateAssignmentDefault,
} from "@/app/assignments/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { SelectInput } from "@/components/admin/select-input";

const initialState: AssignmentActionState = { status: "idle" };

function FormStateNote({ state }: { state: AssignmentActionState }) {
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
  children,
}: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">{caption}</p>
      {children}
    </section>
  );
}

export function AssignmentForms({
  dbConnected,
  routes,
  customers,
  products,
  assignments,
}: {
  dbConnected: boolean;
  routes: AssignmentRouteRecord[];
  customers: AssignmentCustomerRecord[];
  products: AssignmentProductRecord[];
  assignments: AssignmentRecord[];
}) {
  const [assignmentState, assignmentAction, assignmentPending] = useActionState(
    createAssignment,
    initialState,
  );
  const [defaultState, defaultAction, defaultPending] = useActionState(
    createAssignmentDefault,
    initialState,
  );
  const [assignmentUpdateState, assignmentUpdateAction, assignmentUpdatePending] =
    useActionState(updateAssignment, initialState);
  const [defaultUpdateState, defaultUpdateAction, defaultUpdatePending] =
    useActionState(updateAssignmentDefault, initialState);
  const assignmentDefaults = assignments.flatMap((assignment) =>
    assignment.defaults.map((item) => ({
      ...item,
      assignmentId: assignment.id,
      assignmentLabel: `${assignment.routeCode} · ${assignment.sequenceNo} · ${assignment.customerName}`,
    })),
  );

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="xl:col-span-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-7 text-slate-500">
        {dbConnected
          ? "Assignments are now writing to the live database. Build route packets here before opening daily entry."
          : "Assignment forms are ready, but the page is showing demo fallback content until the database connection is available."}
      </div>

      <FormCard
        title="Assign customer to route"
        caption="Set the route order once so the route-entry screen can read a stable packet every day."
      >
        <form action={assignmentAction} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SelectInput
              label="Route"
              name="routeId"
              placeholder="Select route"
              options={routes.map((route) => ({
                value: route.id,
                label: `${route.code} - ${route.name}`,
              }))}
            />
            <SelectInput
              label="Customer"
              name="customerId"
              placeholder="Select customer"
              options={customers.map((customer) => ({
                value: customer.id,
                label: `${customer.code} - ${customer.name}`,
              }))}
            />
            <FormInput
              label="Sequence"
              name="sequenceNo"
              type="number"
              placeholder="1"
              defaultValue="1"
            />
            <SelectInput
              label="Status"
              name="status"
              defaultValue="ACTIVE"
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
            />
          </div>
          <PrimaryButton
            type="submit"
            disabled={assignmentPending || routes.length === 0 || customers.length === 0}
          >
            {assignmentPending ? "Saving..." : "Add assignment"}
          </PrimaryButton>
          <FormStateNote state={assignmentState} />
        </form>
      </FormCard>

      <FormCard
        title="Add default product"
        caption="Attach default quantities and rates per assigned customer so daily entry starts prefilled."
      >
        <form action={defaultAction} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SelectInput
              label="Assignment"
              name="assignmentId"
              placeholder="Select assignment"
              options={assignments.map((assignment) => ({
                value: assignment.id,
                label: `${assignment.routeCode} · ${assignment.sequenceNo} · ${assignment.customerName}`,
              }))}
            />
            <SelectInput
              label="Product"
              name="productId"
              placeholder="Select product"
              options={products.map((product) => ({
                value: product.id,
                label: `${product.code} - ${product.name}`,
              }))}
            />
            <FormInput
              label="Default quantity"
              name="defaultQty"
              type="number"
              placeholder="1.5"
            />
            <FormInput
              label="Default rate"
              name="defaultRate"
              type="number"
              placeholder="34"
            />
          </div>
          <PrimaryButton
            type="submit"
            disabled={defaultPending || assignments.length === 0 || products.length === 0}
          >
            {defaultPending ? "Saving..." : "Add default"}
          </PrimaryButton>
          <FormStateNote state={defaultState} />
        </form>
      </FormCard>

      <FormCard
        title="Update assignment"
        caption="Adjust route, customer, sequence, or status for an existing assignment."
      >
        <form action={assignmentUpdateAction} className="mt-5 space-y-4">
          <SelectInput
            label="Assignment"
            name="id"
            placeholder="Select assignment"
            options={assignments.map((assignment) => ({
              value: assignment.id,
              label: `${assignment.routeCode} · ${assignment.sequenceNo} · ${assignment.customerName}`,
            }))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <SelectInput
              label="Route"
              name="routeId"
              placeholder="Select route"
              options={routes.map((route) => ({
                value: route.id,
                label: `${route.code} - ${route.name}`,
              }))}
            />
            <SelectInput
              label="Customer"
              name="customerId"
              placeholder="Select customer"
              options={customers.map((customer) => ({
                value: customer.id,
                label: `${customer.code} - ${customer.name}`,
              }))}
            />
            <FormInput
              label="Sequence"
              name="sequenceNo"
              type="number"
              placeholder="1"
            />
            <SelectInput
              label="Status"
              name="status"
              placeholder="Select status"
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
            />
          </div>
          <PrimaryButton
            type="submit"
            disabled={assignmentUpdatePending || assignments.length === 0}
          >
            {assignmentUpdatePending ? "Saving..." : "Update assignment"}
          </PrimaryButton>
          <FormStateNote state={assignmentUpdateState} />
        </form>
      </FormCard>

      <FormCard
        title="Update default product"
        caption="Change quantity or rate for an already mapped assignment default."
      >
        <form action={defaultUpdateAction} className="mt-5 space-y-4">
          <SelectInput
            label="Default row"
            name="id"
            placeholder="Select default"
            options={assignmentDefaults.map((item) => ({
              value: item.id,
              label: `${item.assignmentLabel} · ${item.productCode}`,
            }))}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <SelectInput
              label="Assignment"
              name="assignmentId"
              placeholder="Select assignment"
              options={assignments.map((assignment) => ({
                value: assignment.id,
                label: `${assignment.routeCode} · ${assignment.sequenceNo} · ${assignment.customerName}`,
              }))}
            />
            <SelectInput
              label="Product"
              name="productId"
              placeholder="Select product"
              options={products.map((product) => ({
                value: product.id,
                label: `${product.code} - ${product.name}`,
              }))}
            />
            <FormInput
              label="Default quantity"
              name="defaultQty"
              type="number"
              placeholder="1.5"
            />
            <FormInput
              label="Default rate"
              name="defaultRate"
              type="number"
              placeholder="34"
            />
          </div>
          <PrimaryButton
            type="submit"
            disabled={defaultUpdatePending || assignmentDefaults.length === 0}
          >
            {defaultUpdatePending ? "Saving..." : "Update default"}
          </PrimaryButton>
          <FormStateNote state={defaultUpdateState} />
        </form>
      </FormCard>
    </div>
  );
}
