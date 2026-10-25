import type { PaymentMode, PaymentStatus } from "@prisma/client";

// Split out of lib/payments.ts, which depends on next/headers (via
// current-city.ts) and can only run server-side. These two fixed option
// lists have no such dependency, so a client component — the payment-edit
// dialog on the Monthly Deliveries screen — can import them directly instead
// of pulling the whole server module (and its cookies() call) into the
// client bundle.
export const paymentModes: Array<{ value: PaymentMode; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
];

export const paymentStatuses: Array<{ value: PaymentStatus; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "VERIFIED", label: "Verified" },
  { value: "CANCELLED", label: "Cancelled" },
];
