export function dayOffset(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function stockWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const evening = Number(parts.hour) >= 16;
  return { today, cycleDate: evening ? dayOffset(today, 1) : today, eveningDate: evening ? today : dayOffset(today, -1), shift: evening ? "EVENING" as const : "MORNING" as const };
}

export function nextStockTotals(given: number, returned: number, action: string, quantity: number) {
  return {
    given: given + (action === "MORNING_RETURN" ? 0 : action === "EVENING_RETURN" ? -quantity : quantity),
    returned: action === "MORNING_RETURN" ? quantity : returned,
  };
}

// What the driver still has to account for on one product: given minus both
// rounds' deliveries minus what is already returned. Same formula as the web
// vehicle reconciliation. Positive = stock that should come back or be paid
// for (cash / online); negative = a shortage, i.e. a data or loss problem.
export function expectedStock(product: { given: string; returned: string; eveningSold: string; morningSold: string; rate: string }) {
  const qty = Math.round((Number(product.given) - Number(product.eveningSold) - Number(product.morningSold) - Number(product.returned)) * 1000) / 1000;
  return { qty, amount: Math.round(qty * Number(product.rate) * 100) / 100 };
}

export function expectedStockTotal(products: Array<Parameters<typeof expectedStock>[0]>) {
  return Math.round(products.reduce((sum, product) => sum + expectedStock(product).amount, 0) * 100) / 100;
}
