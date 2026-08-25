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
  // The full product name. Sent because `code` and `shortName` are both a
  // single letter in some cities (Rohtak's Buffalo Milk is code "B",
  // shortName "B"), so anywhere the app has room it should say what the
  // product actually is rather than render a bare letter.
  name: string;
  shortName: string | null;
  unit: string;
  // Rate to apply for this delivery (snapshot). Decimal serialized as string.
  rate: string;
  // The customer's most recently delivered quantity for this product, looked
  // up from prior daily entries (up to ~45 days back) since there's no
  // separately configured "usual order" anywhere in this app. "0" if there's
  // no recent history (new customer, or they haven't taken this product).
  defaultQty: string;
  // The quantity currently marked delivered (defaults to defaultQty until the
  // driver saves an explicit value).
  deliveredQty: string;
};

// A customer as the driver sees them on the round, in sequence order, with
// pre-filled deliverables and any marks already recorded for the date.
export type DriverSheetCustomer = {
  customerId: string;
  // The office-facing code (e.g. BHCID0051). Carried so a payment QR can put it
  // in the UPI note, which is how the office matches a receipt back to a
  // customer.
  customerCode: string;
  sequenceNo: number;
  name: string;
  area: string | null;
  mobile: string | null;
  products: DriverSheetProduct[];
  skipped: boolean;
  remarks: string | null;
  // True once a line has been saved for this customer on this date.
  saved: boolean;
  // The PREVIOUS month's bill when it's been issued and is still unpaid, so a
  // driver can nudge the customer at the door. Null when there's nothing to
  // chase — which is most customers, and what keeps the card uncluttered.
  //
  // GENERATED only, deliberately. The office generates and prints at month end
  // and hands bills out on the 1st, so GENERATED means "the customer has this
  // bill in hand". A DRAFT bill was never issued, so asking for payment on it
  // would be asking for money against a bill they've never seen. And LOCKED
  // means the office has already collected — chasing those is the "showing it
  // again and again" problem this is meant to avoid.
  previousBill: {
    billId: string;
    month: string; // YYYY-MM
    outstanding: string; // Decimal serialized as string
  } | null;
  // Captured once, from the first delivery that includes a device location
  // (see DriverSaveLineRequest.location) — never overwritten after that. Null
  // until then; the app shows the Navigate button only once both are set.
  latitude: string | null;
  longitude: string | null;
};

export type DriverSheetResponse = {
  route: DriverRoute;
  date: string; // YYYY-MM-DD
  customers: DriverSheetCustomer[];
  // The city's UPI payee, for building a payment QR on the device. Sent with
  // the sheet so the QR can be produced with no connectivity — only the payee
  // is needed from the server; the amount and note are known locally.
  // Null when the city has no UPI id configured, in which case only cash can
  // be recorded.
  upi: { upiId: string; payeeName: string } | null;
};

// ---- Collecting payment at the door ----

export type DriverPaymentRequest = {
  // Client-generated UUID, used as the payment's primary key. This is what
  // makes the request idempotent: a retry (offline replay, a tapped-twice
  // button) upserts the same row instead of taking the customer's money twice.
  // Deliveries can be re-sent harmlessly because they upsert on entry+customer;
  // a payment has no such natural key, so the client supplies one.
  paymentId: string;
  customerId: string;
  amount: number;
  mode: "CASH" | "UPI";
  // YYYY-MM-DD. Sent by the client so a payment queued offline keeps the date
  // it was actually collected, not the date it eventually synced.
  paidOn: string;
};

export type DriverPaymentResponse = {
  ok: true;
  payment: { id: string; amount: string; mode: string; status: string; paidOn: string };
};

// ---- Customer details a driver can correct ----

export type DriverUpdateCustomerRequest = {
  // Null clears it. Drivers are the ones who discover a wrong or missing
  // number, so they can fix it at the door.
  mobile: string | null;
};

export type DriverUpdateCustomerResponse = {
  ok: true;
  customer: { customerId: string; mobile: string | null };
};

// ---- Per-customer save ----

export type DriverSaveLineRequest = {
  date: string; // YYYY-MM-DD
  skipped: boolean;
  remarks?: string;
  // Numeric here (unlike DriverSheetProduct's string fields, which are
  // Decimal-serialized read values) — this is a request payload the client
  // builds from its own numeric state; the backend's zod schema coerces
  // either shape anyway.
  products: Array<{ productId: string; quantity: number; rateSnapshot: number }>;
  // Device location at the moment of delivery. Backfills the customer's saved
  // location the first time for free; once they already have coordinates, a
  // new fix only overwrites them if confirmLocationUpdate is also true (the
  // driver said yes to a "this looks different, update it?" prompt). Never
  // sent for a skip.
  location?: { latitude: number; longitude: number };
  confirmLocationUpdate?: boolean;
};

export type DriverSaveLineResponse = {
  ok: true;
  saved: DriverSheetCustomer;
};

// ---- Errors ----

export type DriverErrorResponse = {
  error: string;
};
