import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/admin/empty-state";

type DataTableColumn = {
  key: string;
  label: string;
  className?: string;
  headerClassName?: string;
};

type DataTableRow = {
  key: string;
  cells: ReactNode[];
  className?: string;
};

export function DataTable({
  columns,
  rows,
  minWidth = "min-w-full",
  emptyMessage = "No data for selected filters",
  className,
  tableClassName,
  headClassName,
  headerCellClassName,
  bodyClassName,
  rowClassName,
  cellClassName,
}: {
  columns: Array<string | DataTableColumn>;
  rows: DataTableRow[];
  minWidth?: string;
  emptyMessage?: string;
  className?: string;
  tableClassName?: string;
  headClassName?: string;
  headerCellClassName?: string;
  bodyClassName?: string;
  rowClassName?: string;
  cellClassName?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const normalizedColumns = columns.map((column) =>
    typeof column === "string"
      ? { key: column, label: column }
      : column,
  );
  const autoColumnWidth =
    normalizedColumns.length > 0
      ? `${100 / normalizedColumns.length}%`
      : undefined;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className={cn(minWidth, "w-full divide-y divide-slate-200", tableClassName)}>
          <thead className={cn("bg-slate-50", headClassName)}>
            <tr>
              {normalizedColumns.map((column) => (
                <th
                  key={column.key}
                  style={column.className ? undefined : { width: autoColumnWidth }}
                  className={cn(
                    "px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500",
                    headerCellClassName,
                    column.headerClassName,
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={cn("divide-y divide-slate-200 bg-white", bodyClassName)}>
            {rows.map((row) => (
              <tr key={row.key} className={cn("text-sm text-slate-700", rowClassName, row.className)}>
                {row.cells.map((cell, index) => (
                  <td
                    key={`${row.key}-${index}`}
                    style={
                      normalizedColumns[index]?.className
                        ? undefined
                        : { width: autoColumnWidth }
                    }
                    className={cn(
                      "px-4 py-3.5 align-top",
                      cellClassName,
                      normalizedColumns[index]?.className,
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
