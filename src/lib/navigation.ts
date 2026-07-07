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

export const appNavigation = [
  {
    title: "Dashboard",
    href: "/",
    description: "Operations summary and module readiness.",
    icon: DashboardIcon,
  },
  {
    title: "Routes",
    href: "/routes",
    description: "Route setup and vehicle mapping.",
    icon: RouteIcon,
  },
  {
    title: "Route Sequence",
    href: "/monthly-route-sequence",
    description: "Monthly route-wise customer order.",
    icon: UsersIcon,
  },
  {
    title: "Customers",
    href: "/customers",
    description: "Customer master records and balances.",
    icon: UsersIcon,
  },
  {
    title: "Products & Rates",
    href: "/products",
    description: "Product pricing and vehicle support data.",
    icon: ProductIcon,
  },
  {
    title: "Daily Entry",
    href: "/daily-entry",
    description: "Route-wise daily delivery capture.",
    icon: CheckIcon,
  },
  {
    title: "Payments",
    href: "/payments",
    description: "Collection tracking and payment status.",
    icon: WalletIcon,
  },
  {
    title: "Monthly Bills",
    href: "/monthly-bills",
    description: "Bill generation and outstanding view.",
    icon: BillIcon,
  },
  {
    title: "Reconciliation",
    href: "/reconciliation",
    description: "Vehicle and route closing checks.",
    icon: CheckIcon,
  },
  {
    title: "Settings",
    href: "/settings",
    description: "Workspace preferences and setup notes.",
    icon: SettingsIcon,
  },
] as const;
