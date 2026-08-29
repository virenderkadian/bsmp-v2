import type { UserRole } from "@prisma/client";
import {
  BillIcon,
  ChatIcon,
  CheckIcon,
  DashboardIcon,
  ProductIcon,
  RouteIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/admin/icons";

// `subtitle` is the descriptive line shown in the top bar's info-icon
// tooltip (see src/components/admin/top-bar.tsx), replacing the old
// per-screen PageHeader subtitle block so screens keep more vertical space.
//
// `roles`, where present, limits which roles see the item at all. Absent means
// everyone signed in. This only hides the link — each restricted screen still
// checks the role itself, since a hidden link is a convenience, not a control.
export const appNavigation: ReadonlyArray<{
  title: string;
  href: string;
  subtitle: string;
  icon: (props: { className?: string }) => React.ReactElement;
  roles?: readonly UserRole[];
}> = [
  {
    title: "Dashboard",
    href: "/",
    subtitle: "Today's operations, collections, and this month's billing cycle at a glance.",
    icon: DashboardIcon,
  },
  {
    title: "Routes",
    href: "/routes",
    subtitle: "Manage route and vehicle masters used across delivery operations.",
    icon: RouteIcon,
  },
  {
    title: "Route Sequence",
    href: "/monthly-route-sequence",
    subtitle: "Build and manage route-wise customer delivery order.",
    icon: UsersIcon,
  },
  {
    title: "Customers",
    href: "/customers",
    subtitle: "Customer master records, contact details, and opening balances.",
    icon: UsersIcon,
  },
  {
    title: "Products & Rates",
    href: "/products",
    subtitle: "Manage product catalog, units, and default billing rates.",
    icon: ProductIcon,
  },
  {
    title: "Daily Entry",
    href: "/daily-entry",
    subtitle: "Record daily deliveries using the selected route/month customer sequence.",
    icon: CheckIcon,
  },
  {
    title: "Payments",
    href: "/payments",
    subtitle: "Track customer collections and verification status.",
    icon: WalletIcon,
  },
  {
    title: "Monthly Bills",
    href: "/monthly-bills",
    subtitle: "Generate, review, and print customer bills.",
    icon: BillIcon,
  },
  {
    title: "Reconciliation",
    href: "/reconciliation",
    subtitle:
      "Vehicle-wise milk movement: given at evening dispatch, delivered across the evening and morning routes, returned at morning close, and the resulting cash sale or difference.",
    icon: CheckIcon,
  },
  {
    // City-wide outbound messaging: one action here reaches every customer in
    // the city at once, so it is restricted to the roles that already own
    // money-affecting decisions. A USER runs the day's operations and does not
    // decide that two thousand customers get a message.
    title: "WhatsApp",
    href: "/whatsapp",
    subtitle:
      "Send monthly bills and notices to customers on WhatsApp, track what has been sent, and manage consent.",
    icon: ChatIcon,
    roles: ["ADMIN", "SUPERADMIN"],
  },
  {
    title: "Settings",
    href: "/settings",
    subtitle: "Workspace notes, configuration references, and rollout guidance.",
    icon: SettingsIcon,
  },
];

// Which nav items a given role may see. Extracted from the sidebar so it can be
// unit-tested: this decides what appears on *every* screen for *every* user, so
// a mistake here is not confined to one feature.
//
// Fails closed on a null user (a session still resolving) rather than briefly
// flashing a restricted link.
export function visibleNavigationFor(role: UserRole | null | undefined) {
  return appNavigation.filter((item) => !item.roles || (role != null && item.roles.includes(role)));
}
