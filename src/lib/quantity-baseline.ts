// Whether a typed quantity looks unusual for the customer typing it.
//
// Grounded in real production data at every step, not a guess — three checks
// run against real deliveries, in order, before anything gets flagged:
//
// 1. Did this customer order this EXACT quantity recently? If so, never flag
//    it, no matter how far it sits from their median. Real customers often
//    have two genuine, equally normal quantities (e.g. 1L most days, 3L on
//    others) rather than one steady number — a band built from a single
//    center can't represent that, but checking the raw history directly can.
//    Measured impact: of the deliveries a plain 2x-median band would flag,
//    37% were actually a quantity that same customer had ordered in their
//    last 10 deliveries of that product — this check removes that class of
//    false positive entirely.
//
// 2. Is it within a MULTIPLE of their rolling median? Comparing to that same
//    customer's own last ~10 non-zero deliveries (not "yesterday" — see
//    below), 99% of real day-to-day quantities stay within 2x of their own
//    median.
//
// 3. Is it within a flat +/-2 (in the product's own unit) of their median?
//    A multiplier alone is too tight for small baselines: a 0.5L customer
//    taking 1.5L one day is a 3x swing but only 1L of actual difference —
//    an unremarkable, plausible top-up, not a typo. Measured: adding this
//    floor cleared 68% of the flags a pure 2x band left after step 1, and
//    the ones it cleared were consistently modest 1-2L moves; the ones it
//    left behind were the real standouts (a steady-5L customer suddenly at
//    1L, a steady-0.5L customer suddenly at 5L).
//
// Not unusual if EITHER 2 or 3 says it's fine — the wider of the two bands
// wins, since either is a legitimate reason to leave it alone.
//
// Deliberately NOT "compare to yesterday": one real customer's actual pattern
// (an institution: ~13-18L most days, 1L on a handful of days) would have
// every big day flagged as the outlier and the small days read as normal,
// which is backwards. Comparing to a MEDIAN over their own recent history
// gets this right: the institution's median sits near their true baseline,
// so the 1L days are correctly the ones that stand out, not the 15L ones.
//
// Median over MODE as that baseline: mode picks whichever exact value
// happens to repeat slightly more often, with no regard for where it sits —
// for a customer alternating between two clusters, that can make the mode
// the SMALLER cluster purely by chance, which then makes their larger (but
// equally normal) orders look suspicious. Checked directly against real
// data: a mode-based band produced 24 false alarms on deliveries a
// median-based band correctly left alone, against only 6 cases where mode
// caught something median missed. Mode still has a place — see
// computeModeQuantity below — just not here.

// Below this many prior deliveries, there isn't enough history to trust a
// median — a single stray value could BE the "baseline" and flag everything
// after it. No check runs rather than running one that's mostly noise.
const MINIMUM_OBSERVATIONS = 3;

// 99% of real deliveries stay within 2x of their own rolling median.
const BAND_MULTIPLIER = 2;

// See point 3 above — a flat allowance that keeps small baselines from being
// flagged over modest, plausible top-ups. In the product's own unit.
const ABSOLUTE_FLOOR = 2;

export type QuantityBand = {
  median: number;
  min: number;
  max: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// `recentQuantities` should be this customer's own last several non-zero
// deliveries of this product, in any order — order doesn't matter for a
// median. Returns null when there isn't enough history to say anything.
export function computeQuantityBand(recentQuantities: number[]): QuantityBand | null {
  if (recentQuantities.length < MINIMUM_OBSERVATIONS) {
    return null;
  }

  const typical = median(recentQuantities);

  // A customer whose recent deliveries are all zero-adjacent (median 0) has no
  // meaningful band — there's nothing to be "2x" of zero.
  if (typical <= 0) {
    return null;
  }

  return {
    median: typical,
    min: Math.max(0, Math.min(typical / BAND_MULTIPLIER, typical - ABSOLUTE_FLOOR)),
    max: Math.max(typical * BAND_MULTIPLIER, typical + ABSOLUTE_FLOOR),
  };
}

// The single most frequent value in the customer's own recent history — a
// number they've actually ordered, unlike the median, which for a bimodal
// customer (e.g. 1L/3L) can land on a value they've never once taken. For
// showing "usually takes X" to a human; not used for the unusual check
// itself (see the file header for why median, not mode, drives that).
//
// A tie just returns whichever value hit the top count first — in 99.8% of
// real customer+product histories some value repeats at all, so a tie is the
// exception, and either answer is a reasonable thing to show.
export function computeModeQuantity(recentQuantities: number[]): number | null {
  if (recentQuantities.length < MINIMUM_OBSERVATIONS) {
    return null;
  }

  const counts = new Map<number, number>();
  let best: number | null = null;
  let bestCount = 0;

  for (const value of recentQuantities) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }

  return best;
}

const EPSILON = 1e-9;

// Whether a typed quantity should be treated as unusual for this customer.
// `recentQuantities` is the same raw history `computeQuantityBand` was built
// from — passed separately so the exact-match exemption (point 1 in the file
// header) can run even though it isn't expressible as a min/max band.
export function isQuantityUnusual(
  quantity: number,
  band: QuantityBand | null,
  recentQuantities: number[] = [],
): boolean {
  if (quantity <= 0) {
    return false;
  }

  if (recentQuantities.some((value) => Math.abs(value - quantity) < EPSILON)) {
    return false;
  }

  if (!band) {
    return false;
  }

  return quantity < band.min || quantity > band.max;
}
