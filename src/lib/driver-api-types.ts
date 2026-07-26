// Shared HTTP contract between the driver mobile app (mobile/) and the
// /api/driver/* route handlers — the single source of truth for both sides.
//
// The backend route handlers import these directly. The Expo app (which has
// its own node_modules and is NOT an npm workspace member) reaches this file
// through Metro `watchFolders` + a tsconfig path alias, configured in mobile/.
// This file must stay dependency-free (pure types, no runtime imports) so it
// is safe to consume from either project.

export type RouteShift = "MORNING" | "EVENING";

// ---- Auth ----

export type DriverLoginRequest = {
  vehicleCode: string;
  pin: string;
};

export type DriverVehicle = {
  id: string;
  code: string;
  name: string;
  cityId: string;
};

export type DriverLoginResponse = {
  token: string;
  vehicle: DriverVehicle;
};

// ---- Routes ----

export type DriverRoute = {
  id: string;
  code: string;
  name: string;
  shift: RouteShift;
};

export type DriverRoutesResponse = {
  routes: DriverRoute[];
};

// ---- Delivery sheet (a route's round for a date) ----

export type DriverSheetProduct = {
  productId: string;
  code: string;
  shortName: string | null;
  unit: string;
  // Rate to apply for this delivery (snapshot). Decimal serialized as string.
  rate: string;
  // Always "0" today — there is no per-customer "usual order" stored anywhere
  // in this app (matches the web Daily Entry screen, which starts every
  // product at 0 too). Kept as a field in case that changes later.
  defaultQty: string;
  // The quantity currently marked delivered (defaults to defaultQty until the
  // driver saves an explicit value).
  deliveredQty: string;
};

// A customer as the driver sees them on the round, in sequence order, with
// pre-filled deliverables and any marks already recorded for the date.
export type DriverSheetCustomer = {
  customerId: string;
  sequenceNo: number;
  name: string;
  area: string | null;
  mobile: string | null;
  products: DriverSheetProduct[];
  skipped: boolean;
  remarks: string | null;
  // True once a line has been saved for this customer on this date.
  saved: boolean;
};

export type DriverSheetResponse = {
  route: DriverRoute;
  date: string; // YYYY-MM-DD
  customers: DriverSheetCustomer[];
};

// ---- Per-customer save ----

export type DriverSaveLineRequest = {
  date: string; // YYYY-MM-DD
  skipped: boolean;
  remarks?: string;
  products: Array<{ productId: string; quantity: string; rateSnapshot: string }>;
};

export type DriverSaveLineResponse = {
  ok: true;
  saved: DriverSheetCustomer;
};

// ---- Errors ----

export type DriverErrorResponse = {
  error: string;
};
