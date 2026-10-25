// Builds the WhatsApp share message for one vehicle's cycle, or for the
// whole day (every vehicle, plus a cumulative total). Pure string building —
// no network, no DOM — so it runs the same in a client component and in a
// server component.
//
// The per-line figure here is "what actually moved": delivered (evening +
// morning combined) plus any cash-sale leftover, floored at zero. A negative
// leftover means more was delivered+returned than was given — a data-entry
// question for the reconciliation screen to flag, not something that should
// silently shrink the reported sale here. Verified against real production
// data (Bahadurgarh, 18 Oct) line-for-line against the office's own
// hand-typed report before this shape was adopted.
//
// Two templates, not one: a per-vehicle share and a whole-day share have
// genuinely different shapes (one date header shared by every vehicle, plus
// a cumulative total at the end) rather than the whole-day one just being
// the per-vehicle template repeated — see city-settings.shared.ts for the
// placeholder lists and defaults of each.

import type { ReconciliationCycle, ReconciliationRoute } from "@/lib/reconciliation";
import { formatMoney, formatQty } from "@/lib/reconciliation-format";

const DASH_LINE = "-".repeat(30);

function formatCompactDateHeader(cycleDate: string, eveningDate: string) {
  const cycle = new Date(`${cycleDate}T00:00:00.000Z`);
  const evening = new Date(`${eveningDate}T00:00:00.000Z`);
  const month = cycle.toLocaleDateString("en-IN", { month: "short" }).toUpperCase();

  return `${cycle.getUTCDate()} ${month} (${evening.getUTCDate()} EVENING + ${cycle.getUTCDate()} MORNING)`;
}

function routeNames(routes: ReconciliationRoute[]) {
  return routes.length === 0 ? "No route" : routes.map((route) => route.name).join(" + ");
}

// What actually moved for one product on one cycle — the figure the office
// already writes by hand, not the given/returned breakdown.
function productTotal(product: ReconciliationCycle["products"][number]) {
  const delivered = Number(product.eveningDelivered) + Number(product.morningDelivered);
  const leftover = Math.max(0, Number(product.leftover));
  return delivered + leftover;
}

// One line per product that actually sold something — a product nobody
// bought that day is noise, not information.
function compactProductLines(cycle: ReconciliationCycle): string[] {
  return cycle.products
    .map((product) => ({ qty: productTotal(product), label: product.productShortName }))
    .filter((entry) => entry.qty > 0)
    .map((entry) => `${formatQty(entry.qty)} ${entry.label}`);
}

export function buildVehicleShareMessage(cycle: ReconciliationCycle, template: string): string {
  const routes = `${routeNames(cycle.eveningRoutes)} → ${routeNames(cycle.morningRoutes)}`;
  const products = compactProductLines(cycle).join("\n");

  return template
    .replaceAll("{date}", formatCompactDateHeader(cycle.cycleDate, cycle.eveningDate))
    .replaceAll("{vehicleCode}", cycle.vehicleCode)
    .replaceAll("{vehicleName}", cycle.vehicleName)
    .replaceAll("{routes}", routes)
    .replaceAll("{products}", products)
    .replaceAll("{cashSale}", formatMoney(cycle.cashSaleAmount))
    .replaceAll("{received}", formatMoney(cycle.paymentsReceived))
    .replaceAll("{balance}", formatMoney(cycle.balance));
}

export function buildWholeDayShareMessage(cycles: ReconciliationCycle[], template: string): string {
  const blocks = cycles
    .map((cycle) => ({ cycle, lines: compactProductLines(cycle) }))
    .filter((entry) => entry.lines.length > 0)
    .map((entry) => `${entry.cycle.vehicleName}\n${DASH_LINE}\n${entry.lines.join("\n")}`);
  const vehicles = blocks.join(`\n${DASH_LINE}\n`);

  // Order follows reconciliationProducts' own display order, since every
  // cycle's products array is already built from that same list.
  const grandTotal = new Map<string, number>();
  for (const cycle of cycles) {
    for (const product of cycle.products) {
      const qty = productTotal(product);
      if (qty > 0) {
        grandTotal.set(product.productShortName, (grandTotal.get(product.productShortName) ?? 0) + qty);
      }
    }
  }
  const total = [...grandTotal.entries()].map(([label, qty]) => `${formatQty(qty)} ${label}`).join("\n");

  const first = cycles[0];
  const date = first ? formatCompactDateHeader(first.cycleDate, first.eveningDate) : "";

  return template.replaceAll("{date}", date).replaceAll("{vehicles}", vehicles).replaceAll("{total}", total);
}

export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
