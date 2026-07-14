import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 13h7V4H4z" />
      <path d="M13 20h7v-9h-7z" />
      <path d="M13 11h7V4h-7z" />
      <path d="M4 20h7v-5H4z" />
    </BaseIcon>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 19c5 0 5-14 10-14 3.5 0 4 3 6 3" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
    </BaseIcon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </BaseIcon>
  );
}

export function ProductIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M12 12 4 7.5" />
      <path d="M12 12l8-4.5" />
      <path d="M12 12v9" />
    </BaseIcon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M3 7V6a2 2 0 0 1 2-2h12" />
      <path d="M17 13h4" />
    </BaseIcon>
  );
}

export function BillIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 3h8l4 4v14H8z" />
      <path d="M16 3v4h4" />
      <path d="M10 12h8" />
      <path d="M10 16h8" />
    </BaseIcon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </BaseIcon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.38-.1.72-.32 1-.6a1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09c0 .38.12.74.33 1 .28.28.62.5 1 .6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.45.45-.58 1.12-.33 1.82.1.38.32.72.6 1 .26.21.62.33 1 .33H21a2 2 0 1 1 0 4h-.09c-.38 0-.74.12-1 .33-.28.28-.5.62-.6 1Z" />
    </BaseIcon>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
      <path d="M8 16H3v5" />
    </BaseIcon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </BaseIcon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" />
    </BaseIcon>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </BaseIcon>
  );
}

export function ViewIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </BaseIcon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </BaseIcon>
  );
}

export function ToggleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M16 3.5a8.5 8.5 0 1 0 0 17" />
      <path d="M8 12h8" />
    </BaseIcon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </BaseIcon>
  );
}

export function SidebarPanelIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </BaseIcon>
  );
}
