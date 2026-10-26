"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { recordBankStatementPayments, type BankReconciliationActionState } from "@/app/payments/bank-reconciliation/actions";
import { RowCustomerPicker, type ConfirmedCustomer } from "@/app/payments/bank-reconciliation/row-customer-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { SelectInput } from "@/components/admin/select-input";
import { Toast } from "@/components/admin/toast";
import {
  cellText,
  guessColumnIndex,
  parseStatementAmount,
  parseStatementDate,
} from "@/lib/bank-statement-parsing";
import { matchStatementRows, type MatchedRow, type StatementRow } from "@/lib/bank-statement-matching";
import type { BankReconciliationPayload } from "@/lib/bank-reconciliation";

const initialState: BankReconciliationActionState = { status: "idle" };

const PAYMENT_MODES = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
];

type ColumnMap = { date: number; amount: number; narration: number };

type RowState = {
  customer: ConfirmedCustomer | null;
  mode: string;
};

function formatMoney(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function BankReconciliationScreen({ payload }: { payload: BankReconciliationPayload }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Raw sheet, before the operator has confirmed which column is which.
  const [headerRow, setHeaderRow] = useState<string[] | null>(null);
  const [dataRows, setDataRows] = useState<unknown[][] | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);

  // The parsed, reviewable statement — set once the operator confirms the
  // column mapping.
  const [statementRows, setStatementRows] = useState<StatementRow[] | null>(null);
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});

  const [state, formAction, pending] = useActionState(recordBankStatementPayments, initialState);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [handledToken, setHandledToken] = useState("");

  const resultKey = `${state.status}:${state.message ?? ""}`;
  if (resultKey !== handledToken) {
    setHandledToken(resultKey);
    if (state.status !== "idle" && state.message) {
      setToast({ tone: state.status === "success" ? "success" : "error", message: state.message });
    }
    // Reset the whole review after a successful commit — the statement that
    // was just recorded shouldn't still be sitting here inviting a re-submit.
    if (state.status === "success") {
      setHeaderRow(null);
      setDataRows(null);
      setColumnMap(null);
      setStatementRows(null);
      setRowStates({});
    }
  }

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // The file input's DOM value isn't React state — clearing it after a
  // successful commit has to happen as an effect, not during render.
  useEffect(() => {
    if (state.status === "success" && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [state.status]);

  async function handleFile(file: File) {
    setParseError(null);
    setParsing(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      if (!worksheet) {
        setParseError("That file has no readable sheet.");
        return;
      }

      const matrix: unknown[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          values.push(cellText(cell.value));
        });
        matrix.push(values);
      });

      if (matrix.length < 2) {
        setParseError("That sheet doesn't have a header row plus at least one data row.");
        return;
      }

      const header = matrix[0].map((value) => String(value ?? "").trim());
      const rows = matrix.slice(1);

      setHeaderRow(header);
      setDataRows(rows);
      setColumnMap({
        date: guessColumnIndex(header, ["date", "txn date", "value date"]),
        amount: guessColumnIndex(header, ["credit", "deposit", "amount"]),
        narration: guessColumnIndex(header, ["narration", "description", "particular", "remark"]),
      });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setParsing(false);
    }
  }

  function confirmColumnMapping() {
    if (!dataRows || !columnMap || columnMap.date < 0 || columnMap.amount < 0) {
      return;
    }

    const rows: StatementRow[] = [];
    dataRows.forEach((row, index) => {
      const date = parseStatementDate(row[columnMap.date]);
      const amount = parseStatementAmount(row[columnMap.amount]);
      const narration = columnMap.narration >= 0 ? String(row[columnMap.narration] ?? "").trim() : "";

      if (!date || !amount) {
        return;
      }

      rows.push({ rowIndex: index, date, amount, narration });
    });

    // Bootstrap: pre-fill any row with exactly one amount-matching candidate.
    // Recomputed once here, not reactively — after this, a confirmed pick
    // only changes through the operator's own click.
    const initialMatches = matchStatementRows(rows, payload.candidates);
    const nextRowStates: Record<number, RowState> = {};
    initialMatches.forEach((row) => {
      nextRowStates[row.rowIndex] = {
        customer:
          row.candidates.length === 1
            ? {
                customerId: row.candidates[0].customerId,
                customerCode: row.candidates[0].customerCode,
                customerName: row.candidates[0].customerName,
                routeId: row.candidates[0].routeId,
              }
            : null,
        mode: "BANK_TRANSFER",
      };
    });

    setStatementRows(rows);
    setRowStates(nextRowStates);
  }

  // Candidate pool used for the *suggestion chips* on rows that don't yet
  // have a confirmed customer — a customer already confirmed elsewhere for
  // the same amount drops out, so the same person isn't offered twice.
  const excludedCustomerIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(rowStates).forEach((row) => {
      if (row.customer) {
        ids.add(row.customer.customerId);
      }
    });
    return ids;
  }, [rowStates]);

  const liveMatches: MatchedRow[] = useMemo(() => {
    if (!statementRows) return [];
    return matchStatementRows(statementRows, payload.candidates, excludedCustomerIds);
  }, [statementRows, payload.candidates, excludedCustomerIds]);

  const confirmedRows = statementRows
    ? statementRows
        .filter((row) => rowStates[row.rowIndex]?.customer)
        .map((row) => {
          const rowState = rowStates[row.rowIndex]!;
          const customer = rowState.customer!;
          return {
            customerId: customer.customerId,
            routeId: customer.routeId,
            amount: row.amount,
            paymentDate: row.date,
            mode: rowState.mode,
            narration: row.narration,
          };
        })
    : [];

  if (!payload.dbConnected) {
    return <EmptyState message={payload.error ?? "Unable to load outstanding balances right now."} />;
  }

  return (
    <div className="space-y-5">
      {!statementRows ? (
        <section className="space-y-4 rounded-xl border border-surface-border bg-surface p-5 shadow-sm">
          <div>
            <h2 className="text-base font-semibold text-text-primary">1. Upload the bank statement</h2>
            <p className="mt-1 text-sm text-text-secondary">
              An Excel export of the bank statement. Nothing is saved until you review and confirm matches below.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="block w-full text-sm text-text-secondary"
          />
          {parsing ? <p className="text-sm text-text-secondary">Reading the sheet…</p> : null}
          {parseError ? <p className="text-sm text-rose-700">{parseError}</p> : null}

          {headerRow && columnMap ? (
            <div className="space-y-3 border-t border-surface-border pt-4">
              <h3 className="text-sm font-semibold text-text-primary">2. Which columns are which?</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectInput
                  label="Date column"
                  value={columnMap.date >= 0 ? String(columnMap.date) : ""}
                  onChange={(event) => setColumnMap({ ...columnMap, date: event.target.value === "" ? -1 : Number(event.target.value) })}
                  placeholder="Select column"
                  options={headerRow.map((label, index) => ({ value: String(index), label: label || `Column ${index + 1}` }))}
                />
                <SelectInput
                  label="Amount column"
                  value={columnMap.amount >= 0 ? String(columnMap.amount) : ""}
                  onChange={(event) => setColumnMap({ ...columnMap, amount: event.target.value === "" ? -1 : Number(event.target.value) })}
                  placeholder="Select column"
                  options={headerRow.map((label, index) => ({ value: String(index), label: label || `Column ${index + 1}` }))}
                />
                <SelectInput
                  label="Narration column (optional)"
                  value={columnMap.narration >= 0 ? String(columnMap.narration) : ""}
                  onChange={(event) => setColumnMap({ ...columnMap, narration: event.target.value === "" ? -1 : Number(event.target.value) })}
                  placeholder="None"
                  options={headerRow.map((label, index) => ({ value: String(index), label: label || `Column ${index + 1}` }))}
                />
              </div>
              <PrimaryButton
                type="button"
                onClick={confirmColumnMapping}
                disabled={columnMap.date < 0 || columnMap.amount < 0}
              >
                Parse statement
              </PrimaryButton>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-sm">
            <p className="text-sm text-text-secondary">
              {statementRows.length} row{statementRows.length === 1 ? "" : "s"} parsed · {confirmedRows.length} matched to a
              customer so far.
            </p>
            <SecondaryButton
              type="button"
              onClick={() => {
                setStatementRows(null);
                setRowStates({});
                setHeaderRow(null);
                setDataRows(null);
                setColumnMap(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Start over with a different file
            </SecondaryButton>
          </section>

          <DataTable
            columns={[
              { key: "date", label: "Date", className: "whitespace-nowrap" },
              { key: "amount", label: "Amount", className: "text-right whitespace-nowrap" },
              { key: "narration", label: "Narration" },
              { key: "customer", label: "Matched customer" },
              { key: "mode", label: "Mode", className: "whitespace-nowrap" },
            ]}
            rows={liveMatches.map((row) => {
              const rowState = rowStates[row.rowIndex] ?? { customer: null, mode: "BANK_TRANSFER" };
              return {
                key: String(row.rowIndex),
                cells: [
                  <span key="date" className="text-text-secondary">{formatDate(row.date)}</span>,
                  <span key="amount" className="block text-right font-medium tabular-nums text-text-primary">
                    {formatMoney(row.amount)}
                  </span>,
                  <span key="narration" className="text-xs text-text-secondary">{row.narration || "—"}</span>,
                  <RowCustomerPicker
                    key="customer"
                    rowDate={row.date}
                    suggestions={row.candidates}
                    selected={rowState.customer}
                    onSelect={(customer) =>
                      setRowStates((current) => ({
                        ...current,
                        [row.rowIndex]: { customer, mode: current[row.rowIndex]?.mode ?? "BANK_TRANSFER" },
                      }))
                    }
                  />,
                  <SelectInput
                    key="mode"
                    name="mode"
                    value={rowState.mode}
                    onChange={(event) =>
                      setRowStates((current) => ({
                        ...current,
                        [row.rowIndex]: { customer: current[row.rowIndex]?.customer ?? null, mode: event.target.value },
                      }))
                    }
                    options={PAYMENT_MODES}
                    className="h-8 text-xs"
                  />,
                ],
              };
            })}
          />

          <form action={formAction} className="flex items-center justify-end gap-3">
            <input type="hidden" name="rows" value={JSON.stringify(confirmedRows)} readOnly />
            <PrimaryButton type="submit" disabled={pending || confirmedRows.length === 0}>
              {pending ? "Recording..." : `Record ${confirmedRows.length} payment${confirmedRows.length === 1 ? "" : "s"}`}
            </PrimaryButton>
          </form>
        </>
      )}

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
