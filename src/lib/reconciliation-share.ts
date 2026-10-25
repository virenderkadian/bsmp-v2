// Builds the WhatsApp share message for one vehicle's cycle, or for a whole
// day (every vehicle's message, one after another). Pure string building —
// no network, no DOM — so it runs the same in a client component and in a
// server component.
//
// The template is per-city free text (see city-settings.shared.ts for the
// placeholder list and the default). A whole-day share renders the template
// once per vehicle rather than needing its own repeat syntax, which is what
// keeps the template itself simple enough to hand-edit from Settings.

import type { ReconciliationCycle, ReconciliationRoute } from "@/lib/reconciliation";
import { formatMoney, formatQty } from "@/lib/reconciliation-format";

function formatShareDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function routeNames(routes: ReconciliationRoute[]) {
  return routes.length === 0 ? "No route" : routes.map((route) => route.name).join(" + ");
}

function formatProductBlock(product: ReconciliationCycle["products"][number]) {
  const delivered = Number(product.eveningDelivered) + Number(product.morningDelivered);

  return `*${product.productName}*
Given ${formatQty(product.given)} · Delivered ${formatQty(delivered)}
Returned ${formatQty(product.returned)} · Leftover ${formatQty(product.leftover)} → ${formatMoney(product.leftoverValue)}`;
}

export function buildVehicleShareMessage(cycle: ReconciliationCycle, template: string): string {
  const routes = `${routeNames(cycle.eveningRoutes)} → ${routeNames(cycle.morningRoutes)}`;
  const products = cycle.products.map(formatProductBlock).join("\n\n");

  return template
    .replaceAll("{date}", formatShareDate(cycle.cycleDate))
    .replaceAll("{vehicleCode}", cycle.vehicleCode)
    .replaceAll("{vehicleName}", cycle.vehicleName)
    .replaceAll("{routes}", routes)
    .replaceAll("{products}", products)
    .replaceAll("{cashSale}", formatMoney(cycle.cashSaleAmount))
    .replaceAll("{received}", formatMoney(cycle.paymentsReceived))
    .replaceAll("{balance}", formatMoney(cycle.balance));
}

export function buildWholeDayShareMessage(cycles: ReconciliationCycle[], template: string): string {
  return cycles.map((cycle) => buildVehicleShareMessage(cycle, template)).join("\n\n—\n\n");
}

export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
