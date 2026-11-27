// A vehicle is "unsettled" for a day when its cash sale and the payments received for it do not
// net to zero. Under half a paisa is rounding, not an open amount.
export function isUnsettled(row: { balance: string | number }): boolean {
  return Math.abs(Number(row.balance)) >= 0.005;
}
