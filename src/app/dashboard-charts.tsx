"use client";

import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataTable } from "@/components/admin/data-table";
import type { AnalyticsPayload } from "@/lib/dashboard-analytics";

const COLORS = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

function formatDateLabel(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatQty(value: string) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function WowLabel({ deltaQuantity, deltaPercent }: { deltaQuantity: string; deltaPercent: string | null }) {
  const isNegative = Number(deltaQuantity) < 0;
  return (
    <span className={`font-semibold ${isNegative ? "text-rose-600" : "text-emerald-700"}`}>
      WoW {Number(deltaQuantity) >= 0 ? "+" : ""}
      {formatQty(deltaQuantity)} L
      {deltaPercent !== null ? ` (${Number(deltaPercent) >= 0 ? "+" : ""}${deltaPercent}%)` : ""}
    </span>
  );
}

export function TrendChart({ trend }: { trend: AnalyticsPayload["trend"] }) {
  if (!trend) {
    return null;
  }

  const data = trend.points.map((point) => ({ date: formatDateLabel(point.date), quantity: Number(point.quantity) }));

  return (
    <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Milk Trend — {trend.vehicleName}</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Total {formatQty(trend.totalQuantity)} L over range ·{" "}
          <WowLabel deltaQuantity={trend.wowDeltaQuantity} deltaPercent={trend.wowDeltaPercent} />
        </p>
      </div>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(1)} L`} />
            <Line type="monotone" dataKey="quantity" stroke={COLORS[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ComparisonChart({
  trend,
  comparison,
}: {
  trend: AnalyticsPayload["trend"];
  comparison: AnalyticsPayload["comparison"];
}) {
  if (!trend) {
    return null;
  }

  const compByDate = new Map((comparison?.points ?? []).map((point) => [point.date, Number(point.quantity)]));
  const data = trend.points.map((point) => ({
    date: formatDateLabel(point.date),
    [trend.vehicleName]: Number(point.quantity),
    ...(comparison ? { [comparison.vehicleName]: compByDate.get(point.date) ?? 0 } : {}),
  }));

  const series = comparison ? [trend, comparison] : [trend];

  return (
    <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary">Group Comparison</h2>
      <p className="mt-1 text-sm text-text-secondary">
        {comparison ? `${trend.vehicleName} vs ${comparison.vehicleName}` : "Pick a second vehicle to compare"}
      </p>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(1)} L`} />
            <Legend />
            <Line type="monotone" dataKey={trend.vehicleName} stroke={COLORS[0]} strokeWidth={2} dot={false} />
            {comparison ? (
              <Line type="monotone" dataKey={comparison.vehicleName} stroke={COLORS[1]} strokeWidth={2} dot={false} />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3">
        <DataTable
          columns={["Vehicle", "Total Qty (L)", "WoW Δ (L)", "WoW %"]}
          headerCellClassName="px-3 py-2"
          cellClassName="px-3 py-2 text-sm"
          rows={series.map((item) => ({
            key: item.vehicleId,
            cells: [
              item.vehicleName,
              formatQty(item.totalQuantity),
              <WowLabel key="wow" deltaQuantity={item.wowDeltaQuantity} deltaPercent={null} />,
              item.wowDeltaPercent !== null ? `${item.wowDeltaPercent}%` : "-",
            ],
          }))}
          emptyMessage="No data for this range"
        />
      </div>
    </section>
  );
}

export function ProductContributionCharts({
  productContribution,
}: {
  productContribution: AnalyticsPayload["productContribution"];
}) {
  if (productContribution.length === 0) {
    return null;
  }

  const vehicleNames = Array.from(
    new Set(productContribution.flatMap((product) => product.byVehicle.map((v) => v.vehicleName))),
  );

  return (
    <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary">Product Contribution by Vehicle</h2>
      <p className="mt-1 text-sm text-text-secondary">Share of each product&apos;s total volume delivered by vehicle, over the selected range.</p>

      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {productContribution.map((product) => (
          <div key={product.productId} className="text-center">
            <p className="text-sm font-semibold text-text-primary">{product.productName}</p>
            <p className="text-xs text-text-secondary">
              {formatQty(product.totalQuantity)} {product.unit}
            </p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={product.byVehicle.map((v) => ({ ...v, quantity: Number(v.quantity) }))}
                    dataKey="quantity"
                    nameKey="vehicleName"
                    innerRadius={50}
                    outerRadius={80}
                  >
                    {product.byVehicle.map((v, index) => (
                      <Cell key={v.vehicleId} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toFixed(1)} ${product.unit}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <DataTable
          columns={["Vehicle", ...productContribution.map((product) => `${product.productName} (${product.unit})`), "Total"]}
          headerCellClassName="px-3 py-2"
          cellClassName="px-3 py-2 text-sm"
          rows={vehicleNames.map((vehicleName) => {
            let rowTotal = 0;
            const cells = productContribution.map((product) => {
              const entry = product.byVehicle.find((v) => v.vehicleName === vehicleName);
              const qty = Number(entry?.quantity ?? 0);
              rowTotal += qty;
              return qty === 0 ? "-" : formatQty(String(qty));
            });

            return {
              key: vehicleName,
              cells: [vehicleName, ...cells, <span key="total" className="font-semibold">{formatQty(String(rowTotal))}</span>],
            };
          })}
          emptyMessage="No data for this range"
        />
      </div>
    </section>
  );
}
