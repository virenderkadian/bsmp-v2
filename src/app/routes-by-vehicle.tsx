import { formatMoney } from "@/app/summary-card";
import { StatusBadge } from "@/components/admin/status-badge";
import type { DashboardProduct } from "@/lib/dashboard";
import type { VehicleRouteGroup } from "@/lib/dashboard-routes";
import { cn } from "@/lib/utils";

function formatQuantity(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

// "Milk 24 · Curd 6", in the order the products are set up; nothing for a product not delivered.
function quantityLine(quantityByProduct: Record<string, number>, products: DashboardProduct[]) {
  return products
    .filter((product) => (quantityByProduct[product.id] ?? 0) !== 0)
    .map((product) => `${product.shortName ?? product.name} ${formatQuantity(quantityByProduct[product.id])}`)
    .join(" · ");
}

export function RoutesByVehicle({
  groups,
  products,
  date,
  live,
}: {
  groups: VehicleRouteGroup[];
  products: DashboardProduct[];
  date: string;
  live: boolean;
}) {
  const savedRoutes = groups.reduce((sum, group) => sum + group.savedCount, 0);
  const totalRoutes = groups.reduce((sum, group) => sum + group.routes.length, 0);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Routes by vehicle</h2>
          <p className="text-xs text-text-secondary">
            {savedRoutes} of {totalRoutes} routes have a daily entry for {date}. Routes still waiting are listed first.
          </p>
        </div>
        <StatusBadge tone={live ? "success" : "warning"}>{live ? "Live sync" : "Fallback mode"}</StatusBadge>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4 text-sm text-text-secondary">No active routes yet</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const allSaved = group.savedCount === group.routes.length;
            const totals = quantityLine(group.quantityByProduct, products);
            return (
              <article
                key={group.vehicleId ?? "none"}
                className="flex flex-col overflow-hidden rounded-lg border border-surface-border bg-surface shadow-sm"
              >
                <header className="flex items-start justify-between gap-3 border-b border-surface-border bg-surface-muted px-3.5 py-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-text-primary">{group.vehicleName}</h3>
                  </div>
                  <span className="shrink-0 whitespace-nowrap">
                    <StatusBadge tone={allSaved ? "success" : "warning"}>
                      {group.savedCount} of {group.routes.length} saved
                    </StatusBadge>
                  </span>
                </header>

                <ul className="flex-1 divide-y divide-surface-border">
                  {group.routes.map((route) => (
                    <li key={route.routeId} className="px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary">{route.routeName}</p>
                          <p className="text-xs text-text-secondary">
                            {route.shift === "MORNING" ? "Morning" : "Evening"} · {route.routeCode}
                          </p>
                        </div>
                        {route.saved ? (
                          <span className="shrink-0 text-sm font-medium tabular-nums text-text-primary">{formatMoney(route.amount)}</span>
                        ) : (
                          <span className="shrink-0 text-xs font-medium text-status-warning-text">Pending</span>
                        )}
                      </div>
                      {route.saved ? (
                        <p className={cn("mt-1 text-xs", quantityLine(route.quantityByProduct, products) ? "text-text-secondary" : "text-text-muted")}>
                          {quantityLine(route.quantityByProduct, products) || "Nothing delivered"}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <footer className="border-t border-surface-border-strong px-3.5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium text-text-secondary">Vehicle total</span>
                    <span className="text-sm font-semibold tabular-nums text-text-primary">{formatMoney(group.amount)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{totals || "Nothing delivered yet"}</p>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
