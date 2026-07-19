import {
  BillIcon,
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
export const appNavigation = [
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
    title: "Settings",
    href: "/settings",
    subtitle: "Workspace notes, configuration references, and rollout guidance.",
    icon: SettingsIcon,
  },
] as const;
