import { resolveBillingRoutes, selectBillingRows } from "@/lib/monthly-bills-math";

// Who appears on a collections sheet, and what each of them owes.
//
// Kept pure and apart from the database call so the rules can be tested, since
// this is where a real money bug lived: the sheet was scoped by ROUTE, so a
// customer running a morning and an evening round appeared under both. Their
// single combined bill is filed against one of those routes, so on the other
// one no bill was found and the page silently fell back to an estimate built
// from that round's deliveries alone — showing ₹4,845 due where ₹8,187.50 was
// owed. Everything here is keyed by CUSTOMER for that reason.

export type SheetShift = "MORNING" | "EVENING";

// Morning before evening, which is the order the rounds are run. NOT
// alphabetical: "EVENING" sorts before "MORNING", so a plain string comparison
// silently reverses the sheet.
const SHIFT_RANK: Record<SheetShift, number> = { MORNING: 0, EVENING: 1 };

export type SheetSequenceLine = {
  customerId: string;
  routeId: string;
  billsHere: boolean;
  sequenceNo: number;
};

export type SheetMoney = {
  // From an issued bill, when the month has been generated.
  bill?: { openingBalance: number; deliveryAmount: number };
  // Carried forward from the previous month's closing, for the estimate path.
  priorClosing?: number;
  // The customer's first-ever balance, used only when they have no prior bill.
  staticOpening: number;
  // Deliveries this month across EVERY route they run, not just one round.
  deliveredThisMonth: number;
  // Verified payments not already frozen into a locked bill.
  alreadyPaid: number;
};

export type SheetRow = {
  customerId: string;
  routeId: string;
  sequenceNo: number;
  shift: SheetShift;
  openingOutstanding: number;
  monthlyBillAmount: number;
  alreadyPaid: number;
  pendingAmount: number;
  source: "BILL" | "ESTIMATE";
};

function amountsFor(money: SheetMoney) {
  const openingOutstanding = money.bill
    ? money.bill.openingBalance
    : (money.priorClosing ?? money.staticOpening);
  const monthlyBillAmount = money.bill ? money.bill.deliveryAmount : money.deliveredThisMonth;

  return {
    openingOutstanding,
    monthlyBillAmount,
    alreadyPaid: money.alreadyPaid,
    pendingAmount: openingOutstanding + monthlyBillAmount - money.alreadyPaid,
    source: (money.bill ? "BILL" : "ESTIMATE") as "BILL" | "ESTIMATE",
  };
}

// The rows for one sheet: every customer whose BILLING route is covered by it,
// exactly once, in walking order.
export function buildCollectionRows(input: {
  sequenceLines: SheetSequenceLine[];
  sheetRouteIds: Set<string>;
  shiftByRoute: Map<string, SheetShift>;
  moneyByCustomer: Map<string, SheetMoney>;
}): SheetRow[] {
  const billingRoutes = resolveBillingRoutes(input.sequenceLines);

  return selectBillingRows(input.sequenceLines, billingRoutes)
    .filter((line) => input.sheetRouteIds.has(line.routeId))
    .map((line) => {
      const money = input.moneyByCustomer.get(line.customerId);
      const shift = input.shiftByRoute.get(line.routeId) ?? "MORNING";
      const amounts = amountsFor(
        money ?? { staticOpening: 0, deliveredThisMonth: 0, alreadyPaid: 0 },
      );
      return { customerId: line.customerId, routeId: line.routeId, sequenceNo: line.sequenceNo, shift, ...amounts };
    })
    .sort((left, right) => {
      // Both rounds number their customers from 1, so sequenceNo alone
      // interleaves them into nonsense.
      const leftRank = SHIFT_RANK[left.shift];
      const rightRank = SHIFT_RANK[right.shift];
      return leftRank === rightRank ? left.sequenceNo - right.sequenceNo : leftRank - rightRank;
    });
}

// Customers who still owe money and are NOT on this sheet — billed on another
// vehicle's round, or off the sequence entirely while carrying a balance.
// Without them such a payment cannot be recorded at all: not in the list, and
// not findable by searching it.
export function buildOffRoundCustomers(input: {
  listedCustomerIds: Set<string>;
  candidateCustomerIds: string[];
  moneyByCustomer: Map<string, SheetMoney>;
}): Array<{ customerId: string; outstanding: number; source: "BILL" | "ESTIMATE" }> {
  const result: Array<{ customerId: string; outstanding: number; source: "BILL" | "ESTIMATE" }> = [];

  for (const customerId of input.candidateCustomerIds) {
    if (input.listedCustomerIds.has(customerId)) {
      continue;
    }
    const money = input.moneyByCustomer.get(customerId);
    if (!money) {
      continue;
    }
    const amounts = amountsFor(money);
    // Only people who owe something: you cannot collect from someone with no
    // balance, and it keeps this list far smaller than "every customer".
    if (amounts.pendingAmount <= 0) {
      continue;
    }
    result.push({ customerId, outstanding: amounts.pendingAmount, source: amounts.source });
  }

  return result;
}
