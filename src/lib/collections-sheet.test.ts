import { describe, expect, it } from "vitest";
import {
  buildCollectionRows,
  buildOffRoundCustomers,
  type SheetMoney,
  type SheetSequenceLine,
} from "@/lib/collections-sheet";

// Production shape: one vehicle, a morning and an evening round.
const MORNING = "route-morning";
const EVENING = "route-evening";
const OTHER_VEHICLE = "route-other-vehicle";

const SHIFTS = new Map<string, "MORNING" | "EVENING">([
  [MORNING, "MORNING"],
  [EVENING, "EVENING"],
  [OTHER_VEHICLE, "MORNING"],
]);

const BOTH_ROUNDS = new Set([MORNING, EVENING]);

function money(overrides: Partial<SheetMoney> = {}): SheetMoney {
  return { staticOpening: 0, deliveredThisMonth: 0, alreadyPaid: 0, ...overrides };
}

function line(
  customerId: string,
  routeId: string,
  sequenceNo: number,
  billsHere = false,
): SheetSequenceLine {
  return { customerId, routeId, sequenceNo, billsHere };
}

describe("buildCollectionRows", () => {
  it("lists a customer running both rounds exactly once", () => {
    // The bug: scoping by route put this customer on both sheets.
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 4), line("c1", EVENING, 9, true)],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([["c1", money({ bill: { openingBalance: 40, deliveryAmount: 8147.5 } })]]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].routeId).toBe(EVENING);
  });

  it("uses the combined bill, not one round's deliveries", () => {
    // Real production figures: ₹8,187.50 owed, but the morning round alone had
    // only ₹4,845 of milk on it.
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 4), line("c1", EVENING, 9, true)],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([
        ["c1", money({ bill: { openingBalance: 40, deliveryAmount: 8147.5 }, deliveredThisMonth: 4845 })],
      ]),
    });

    expect(rows[0].pendingAmount).toBe(8187.5);
    expect(rows[0].source).toBe("BILL");
  });

  it("puts the customer on the round that bills them, not the earlier one", () => {
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 1), line("c1", EVENING, 2, true)],
      sheetRouteIds: new Set([MORNING]),
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([["c1", money()]]),
    });

    // Their bill lives on the evening round, so a morning-only sheet omits them.
    expect(rows).toEqual([]);
  });

  it("falls back to the earliest round when no round is flagged", () => {
    // billsHere is enforced by a partial unique index that forbids a SECOND
    // true — it does not force one to exist, so "none set" is reachable.
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 1), line("c1", EVENING, 2)],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([["c1", money()]]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].routeId).toBe(MORNING);
  });

  it("orders morning before evening, each in its own walking order", () => {
    // Both rounds number from 1, so sequenceNo alone interleaves them.
    const rows = buildCollectionRows({
      sequenceLines: [
        line("evening-1", EVENING, 1, true),
        line("morning-2", MORNING, 2, true),
        line("morning-1", MORNING, 1, true),
        line("evening-2", EVENING, 2, true),
      ],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map(),
    });

    expect(rows.map((row) => row.customerId)).toEqual([
      "morning-1",
      "morning-2",
      "evening-1",
      "evening-2",
    ]);
  });

  it("narrows to a single round when a shift is selected", () => {
    const rows = buildCollectionRows({
      sequenceLines: [line("m", MORNING, 1, true), line("e", EVENING, 1, true)],
      sheetRouteIds: new Set([MORNING]),
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map(),
    });

    expect(rows.map((row) => row.customerId)).toEqual(["m"]);
  });

  it("estimates from the carried balance and the whole month before a bill exists", () => {
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 1, true)],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([
        ["c1", money({ priorClosing: 169, deliveredThisMonth: 1200, staticOpening: 0, alreadyPaid: 200 })],
      ]),
    });

    expect(rows[0].source).toBe("ESTIMATE");
    // 169 carried + 1200 delivered - 200 paid. The static opening is ignored
    // because a prior bill exists.
    expect(rows[0].pendingAmount).toBe(1169);
  });

  it("uses the static opening only for a customer with no prior bill", () => {
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 1, true)],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([["c1", money({ staticOpening: 500, deliveredThisMonth: 100 })]]),
    });

    expect(rows[0].pendingAmount).toBe(600);
  });

  it("subtracts what has already been paid", () => {
    const rows = buildCollectionRows({
      sequenceLines: [line("c1", MORNING, 1, true)],
      sheetRouteIds: BOTH_ROUNDS,
      shiftByRoute: SHIFTS,
      moneyByCustomer: new Map([
        ["c1", money({ bill: { openingBalance: 0, deliveryAmount: 1000 }, alreadyPaid: 400 })],
      ]),
    });

    expect(rows[0].pendingAmount).toBe(600);
  });
});

describe("buildOffRoundCustomers", () => {
  it("finds someone billed on another vehicle who still owes", () => {
    const offRound = buildOffRoundCustomers({
      listedCustomerIds: new Set(["listed"]),
      candidateCustomerIds: ["listed", "elsewhere"],
      moneyByCustomer: new Map([
        ["listed", money({ bill: { openingBalance: 0, deliveryAmount: 100 } })],
        ["elsewhere", money({ bill: { openingBalance: 0, deliveryAmount: 8000 } })],
      ]),
    });

    expect(offRound).toEqual([{ customerId: "elsewhere", outstanding: 8000, source: "BILL" }]);
  });

  it("reaches a customer who has dropped off every sequence but still owes", () => {
    // 15 real customers were in exactly this state: a balance, no sequence row,
    // and therefore no way at all to record a payment from them.
    const offRound = buildOffRoundCustomers({
      listedCustomerIds: new Set(),
      candidateCustomerIds: ["dropped"],
      moneyByCustomer: new Map([["dropped", money({ priorClosing: 85 })]]),
    });

    expect(offRound).toEqual([{ customerId: "dropped", outstanding: 85, source: "ESTIMATE" }]);
  });

  it("leaves out anyone who owes nothing", () => {
    const offRound = buildOffRoundCustomers({
      listedCustomerIds: new Set(),
      candidateCustomerIds: ["settled", "overpaid"],
      moneyByCustomer: new Map([
        ["settled", money({ bill: { openingBalance: 0, deliveryAmount: 500 }, alreadyPaid: 500 })],
        ["overpaid", money({ bill: { openingBalance: 0, deliveryAmount: 500 }, alreadyPaid: 900 })],
      ]),
    });

    expect(offRound).toEqual([]);
  });

  it("never repeats someone already on the sheet", () => {
    const offRound = buildOffRoundCustomers({
      listedCustomerIds: new Set(["c1"]),
      candidateCustomerIds: ["c1"],
      moneyByCustomer: new Map([["c1", money({ bill: { openingBalance: 5000, deliveryAmount: 0 } })]]),
    });

    expect(offRound).toEqual([]);
  });
});
