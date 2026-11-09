// Decides how a customer's order history for ONE product shows up on the
// driver's delivery card.
//
// A product the customer takes regularly is pre-filled (their "usual order").
// A product they only took now and then is NOT pre-filled — pre-filling it
// meant a one-off paneer from weeks ago came back on every visit, and the
// driver had to remember to zero it. Missing that bills the customer for
// something they never got, silently. Left at 0 and offered as a tap-to-add
// suggestion, forgetting is harmless: the customer simply asks at the door.

export const USUAL_WINDOW_DAYS = 14;
export const USUAL_MIN_DELIVERIES = 2;
// Beyond this, a past delivery is too old to be worth suggesting at all.
export const OCCASIONAL_LOOKBACK_DAYS = 30;

export type RecentEntry = { date: string; quantity: number };

export type OccasionalSuggestion = { quantity: number; date: string; daysAgo: number };

export type RecentOrderSuggestion = {
  // Set when the product is part of the usual order: pre-fill this quantity.
  usualQty?: number;
  // Set when it is not usual but was taken recently: offer, don't pre-fill.
  occasional?: OccasionalSuggestion;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function classifyRecentOrder(entries: RecentEntry[], sheetDate: string): RecentOrderSuggestion {
  // Only deliveries up to the sheet's own date are history for it, newest
  // first. Zero quantities are never stored, but guard anyway.
  const history = entries
    .filter((entry) => entry.quantity > 0 && entry.date <= sheetDate)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const latest = history[0];
  if (!latest) return {};

  const inWindow = history.filter((entry) => daysBetween(entry.date, sheetDate) <= USUAL_WINDOW_DAYS);
  if (inWindow.length >= USUAL_MIN_DELIVERIES) return { usualQty: latest.quantity };

  const daysAgo = daysBetween(latest.date, sheetDate);
  if (daysAgo <= OCCASIONAL_LOOKBACK_DAYS) {
    return { occasional: { quantity: latest.quantity, date: latest.date, daysAgo } };
  }
  return {};
}
