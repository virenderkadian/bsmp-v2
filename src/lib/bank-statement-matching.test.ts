import { describe, expect, it } from "vitest";
import { matchStatementRows, type OutstandingCandidate, type StatementRow } from "@/lib/bank-statement-matching";

const candidate = (overrides: Partial<OutstandingCandidate>): OutstandingCandidate => ({
  customerId: "cust-1",
  customerCode: "C01",
  customerName: "Customer One",
  outstanding: 500,
  routeId: "route-1",
  ...overrides,
});

const row = (overrides: Partial<StatementRow>): StatementRow => ({
  rowIndex: 0,
  date: "2027-01-15",
  amount: 500,
  narration: "",
  ...overrides,
});

describe("matchStatementRows", () => {
  it("suggests the one candidate whose outstanding equals the row's amount", () => {
    const candidates = [candidate({ customerId: "a", outstanding: 500 }), candidate({ customerId: "b", outstanding: 900 })];
    const [matched] = matchStatementRows([row({ amount: 500 })], candidates);
    expect(matched.candidates.map((c) => c.customerId)).toEqual(["a"]);
  });

  it("surfaces every candidate when more than one owes the same amount", () => {
    const candidates = [candidate({ customerId: "a", outstanding: 1200 }), candidate({ customerId: "b", outstanding: 1200 })];
    const [matched] = matchStatementRows([row({ amount: 1200 })], candidates);
    expect(matched.candidates.map((c) => c.customerId).sort()).toEqual(["a", "b"]);
  });

  it("returns no candidates when nothing outstanding matches the amount", () => {
    const candidates = [candidate({ customerId: "a", outstanding: 500 })];
    const [matched] = matchStatementRows([row({ amount: 999 })], candidates);
    expect(matched.candidates).toHaveLength(0);
  });

  it("tolerates rupee-level rounding noise in the comparison", () => {
    const candidates = [candidate({ customerId: "a", outstanding: 500.004 })];
    const [matched] = matchStatementRows([row({ amount: 500 })], candidates);
    expect(matched.candidates.map((c) => c.customerId)).toEqual(["a"]);
  });

  it("drops an excluded customer from the suggestion list, without excluding others", () => {
    const candidates = [candidate({ customerId: "a", outstanding: 500 }), candidate({ customerId: "b", outstanding: 500 })];
    const excluded = new Set(["a"]);
    const [matched] = matchStatementRows([row({ amount: 500 })], candidates, excluded);
    expect(matched.candidates.map((c) => c.customerId)).toEqual(["b"]);
  });

  it("matches each row of a multi-row statement independently", () => {
    const candidates = [candidate({ customerId: "a", outstanding: 500 }), candidate({ customerId: "b", outstanding: 900 })];
    const rows = [row({ rowIndex: 0, amount: 500 }), row({ rowIndex: 1, amount: 900 }), row({ rowIndex: 2, amount: 1 })];
    const matched = matchStatementRows(rows, candidates);
    expect(matched[0].candidates.map((c) => c.customerId)).toEqual(["a"]);
    expect(matched[1].candidates.map((c) => c.customerId)).toEqual(["b"]);
    expect(matched[2].candidates).toHaveLength(0);
  });
});
