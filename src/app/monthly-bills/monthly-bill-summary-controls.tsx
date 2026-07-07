"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FormInput } from "@/components/admin/form-input";
import { BillIcon } from "@/components/admin/icons";
import { SelectInput } from "@/components/admin/select-input";

type SummaryRouteOption = {
  id: string;
  code: string;
  name: string;
};

export function MonthlyBillSummaryControls({
  routes,
  defaultMonth,
}: {
  routes: SummaryRouteOption[];
  defaultMonth: string;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [routeId, setRouteId] = useState("all");
  const summaryHref = useMemo(() => {
    const params = new URLSearchParams();

    params.set("month", month || defaultMonth);
    params.set("routeId", routeId);

    return `/monthly-bills/summary?${params.toString()}`;
  }, [defaultMonth, month, routeId]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput
          label="Month"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
        <SelectInput
          label="Route"
          value={routeId}
          onChange={(event) => setRouteId(event.target.value)}
          options={[
            { value: "all", label: "All routes" },
            ...routes.map((route) => ({
              value: route.id,
              label: `${route.code} - ${route.name}`,
            })),
          ]}
        />
      </div>
      <Link
        href={summaryHref}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 sm:w-auto"
      >
        <BillIcon className="h-4 w-4" />
        Generate summary
      </Link>
    </div>
  );
}
