import QRCode from "qrcode";

// A UPI payment QR.
//
// Two optional parts, both there to make an incoming payment identifiable:
//
//   am  the amount, so the payer isn't typing a figure off a printed page.
//       It is a REQUEST, not a lock — apps differ on whether the payer may
//       edit it — so it removes typos rather than guaranteeing exactness.
//   tn  a note carrying the customer's code and the month, so a credit in
//       the bank statement says who it came from and what it settles.
//
// Whether a payee's statement shows `tn` depends on the bank, so it is a help
// rather than something to rely on. A per-vehicle payee id is the dependable
// grouping; this is the precise one.
//
// Separated from the encoding so it can be asserted directly. Testing the PNG
// would only prove the QR library works; the payload is the part that decides
// what a customer's phone actually offers to pay.
export function buildUpiUri(
  upiId: string,
  payeeName: string,
  options?: { amount?: number | string; note?: string },
): string {
  const parts = [
    `pa=${encodeURIComponent(upiId)}`,
    `pn=${encodeURIComponent(payeeName)}`,
  ];

  // A customer in credit has a negative closing balance, and a zero or negative
  // `am` is not a valid request — those bills get a plain QR instead of a
  // broken one.
  const amount = Number(options?.amount ?? 0);

  if (Number.isFinite(amount) && amount > 0) {
    parts.push(`am=${amount.toFixed(2)}`);
  }

  if (options?.note) {
    // Notes are truncated by some apps, so the identifying part goes first.
    parts.push(`tn=${encodeURIComponent(options.note.slice(0, 40))}`);
  }

  parts.push("cu=INR");

  return `upi://pay?${parts.join("&")}`;
}

export async function generateUpiQrDataUrl(
  upiId: string,
  payeeName: string,
  options?: { amount?: number | string; note?: string },
): Promise<string> {
  return QRCode.toDataURL(buildUpiUri(upiId, payeeName, options), { margin: 1, width: 160 });
}
