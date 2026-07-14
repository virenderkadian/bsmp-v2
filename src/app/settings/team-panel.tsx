"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createUser, setUserActiveState, type ActionState, updateUser } from "@/app/settings/user-actions";
import { ActiveStatusToggle } from "@/components/admin/active-status-toggle";
import { ActionButton, PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { EditIcon, PlusIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { CityRecord, UserRecord } from "@/lib/settings";

const initialState: ActionState = { status: "idle" };

const roleOptions = [
  { value: "SUPERADMIN", label: "Superadmin" },
  { value: "ADMIN", label: "Admin" },
  { value: "USER", label: "User" },
];

function roleLabel(role: UserRecord["role"]) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

type UserDraft = {
  id?: string;
  fullName: string;
  email: string;
  role: UserRecord["role"];
  cityIds: string[];
};

const emptyDraft: UserDraft = { fullName: "", email: "", role: "USER", cityIds: [] };

function CityCheckboxList({
  cities,
  selected,
  onChange,
  disabled,
}: {
  cities: CityRecord[];
  selected: string[];
  onChange: (cityIds: string[]) => void;
  disabled: boolean;
}) {
  const toggle = (cityId: string) => {
    if (selected.includes(cityId)) {
      onChange(selected.filter((id) => id !== cityId));
    } else {
      onChange([...selected, cityId]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">
        {disabled ? "Cities (superadmins can access every city)" : "Cities this account can access"}
      </span>
      <div className={`grid gap-2 rounded-lg border border-surface-border p-3 sm:grid-cols-2 ${disabled ? "opacity-50" : ""}`}>
        {cities.map((city) => (
          <label key={city.id} className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              name="cityIds"
              value={city.id}
              checked={disabled ? false : selected.includes(city.id)}
              disabled={disabled}
              onChange={() => toggle(city.id)}
              className="h-4 w-4 rounded border-surface-border-strong text-blue-600 focus:ring-blue-600"
            />
            {city.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function CreateUserDialog({
  open,
  dbConnected,
  cities,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  cities: CityRecord[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createUser, initialState);
  const [role, setRole] = useState<UserRecord["role"]>("USER");
  const [cityIds, setCityIds] = useState<string[]>([]);

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add team member"
      description="Creates a login the person can use immediately — share the password with them directly."
      footer={null}
    >
      <KeyboardForm action={action} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Full name" name="fullName" placeholder="Ramesh Kumar" autoFocus />
          <FormInput label="Email" name="email" type="email" placeholder="ramesh@example.com" />
          <FormInput label="Temporary password" name="password" type="text" placeholder="At least 6 characters" />
          <SelectInput
            label="Role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRecord["role"])}
            options={roleOptions}
          />
        </div>
        <CityCheckboxList
          cities={cities}
          selected={cityIds}
          onChange={setCityIds}
          disabled={role === "SUPERADMIN"}
        />
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
            {pending ? "Creating..." : "Create user"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

function EditUserDialog({
  open,
  dbConnected,
  cities,
  draft,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  cities: CityRecord[];
  draft: UserDraft;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(updateUser, initialState);
  const [role, setRole] = useState<UserRecord["role"]>(draft.role);
  const [cityIds, setCityIds] = useState<string[]>(draft.cityIds);

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit team member"
      description="Update role and city access. Email and password can't be changed here."
      footer={null}
    >
      <KeyboardForm action={action} className="space-y-4">
        <input type="hidden" name="id" value={draft.id} />
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Full name" name="fullName" defaultValue={draft.fullName} autoFocus />
          <FormInput label="Email" name="emailDisplay" defaultValue={draft.email} disabled />
          <SelectInput
            label="Role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRecord["role"])}
            options={roleOptions}
          />
        </div>
        <CityCheckboxList
          cities={cities}
          selected={cityIds}
          onChange={setCityIds}
          disabled={role === "SUPERADMIN"}
        />
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
            {pending ? "Saving..." : "Update user"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

export function TeamPanel({
  dbConnected,
  users,
  cities,
  currentUserId,
}: {
  dbConnected: boolean;
  users: UserRecord[];
  cities: CityRecord[];
  currentUserId: string;
}) {
  const [search, setSearch] = useState("");
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const cityNameById = useMemo(() => new Map(cities.map((city) => [city.id, city.name])), [cities]);

  const filteredUsers = useMemo(() => {
    const query = search.toLowerCase().trim();
    return users.filter(
      (user) =>
        query === "" ||
        user.fullName.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query),
    );
  }, [users, search]);

  const selectedUser = users.find((user) => user.id === selectedUserId);
  const draft: UserDraft = selectedUser
    ? {
        id: selectedUser.id,
        fullName: selectedUser.fullName,
        email: selectedUser.email,
        role: selectedUser.role,
        cityIds: selectedUser.cityIds,
      }
    : emptyDraft;

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedUserId(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Team</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Superadmins can access every city. Admins and users only see the cities assigned to them.
          </p>
        </div>
        <PrimaryButton
          type="button"
          icon={<PlusIcon className="h-4 w-4" />}
          className="h-10 rounded-md px-5 text-sm font-semibold"
          onClick={() => {
            setSelectedUserId(null);
            setDialogMode("create");
          }}
        >
          Add team member
        </PrimaryButton>
      </div>

      <div className="flex items-center gap-3">
        <SearchInput
          name="userSearch"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
      </div>

      <DataTable
        columns={[
          { key: "user", label: "Name" },
          { key: "role", label: "Role" },
          { key: "cities", label: "Cities" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", className: "text-right", headerClassName: "text-right" },
        ]}
        rows={filteredUsers.map((user) => ({
          key: user.id,
          cells: [
            <div key="user" className="min-w-[200px]">
              <p className="text-[15px] font-semibold leading-6 text-text-primary">
                {user.fullName}
                {user.id === currentUserId ? <span className="ml-2 text-xs font-normal text-text-muted">(you)</span> : null}
              </p>
              <p className="mt-0.5 text-sm text-text-secondary">{user.email}</p>
            </div>,
            <span key="role" className="text-sm text-slate-800">
              {roleLabel(user.role)}
            </span>,
            <span key="cities" className="text-sm text-slate-800">
              {user.role === "SUPERADMIN"
                ? "All cities"
                : user.cityIds.map((id) => cityNameById.get(id) ?? "Unknown").join(", ") || "-"}
            </span>,
            <ActiveStatusToggle
              key="status"
              id={user.id}
              name={user.fullName}
              isActive={user.isActive}
              recordLabel="user"
              action={setUserActiveState}
            />,
            <div key="actions" className="flex justify-end">
              <ActionButton
                type="button"
                icon={<EditIcon className="h-[18px] w-[18px]" />}
                className="h-8 w-8 rounded-md border-none bg-transparent px-0 text-text-primary shadow-none hover:bg-surface-muted"
                onClick={() => {
                  setSelectedUserId(user.id);
                  setDialogMode("edit");
                }}
                aria-label="Edit user"
                title="Edit user"
              >
                <span className="sr-only">Edit user</span>
              </ActionButton>
            </div>,
          ],
        }))}
        emptyMessage="No team members match your search"
        minWidth="min-w-[760px]"
        className="rounded-md border-surface-border shadow-none"
        headClassName="bg-surface-muted/70"
        headerCellClassName="px-5 py-3"
        rowClassName="align-middle hover:bg-surface-muted/60"
        cellClassName="px-5 py-3.5"
      />

      {dialogMode === "create" ? (
        <CreateUserDialog open dbConnected={dbConnected} cities={cities} onClose={closeDialog} />
      ) : null}

      {dialogMode === "edit" ? (
        <EditUserDialog open dbConnected={dbConnected} cities={cities} draft={draft} onClose={closeDialog} />
      ) : null}
    </section>
  );
}
