// Pure calculation core of vehicle reconciliation, split out of
// src/lib/reconciliation.ts so the money math can be unit tested without a
// database. See memory: this given/delivered/returned/cash-sale formula was
// hand-verified against a real worked example when the feature shipped —
// this file exists to keep it that way as the code around it changes.

export function computeLeftover(input: {
  given: number;
  eveningDelivered: number;
  morningDelivered: number;
  returned: number;
}) {
  return input.given - input.eveningDelivered - input.morningDelivered - input.returned;
}

export function computeLeftoverValue(leftover: number, rate: number) {
  return leftover * rate;
}

export function computeVehicleBalance(cashSaleAmount: number, paymentsReceived: number) {
  return cashSaleAmount - paymentsReceived;
}
