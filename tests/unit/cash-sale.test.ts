import { beforeEach, describe, expect, it } from "vitest";
import { __reset, __setDelay } from "../stubs/async-storage";
import {
  addCashSaleEntry,
  deleteCashSaleEntry,
  getCashSaleEntries,
  summariseCashSales,
} from "../../mobile/src/cash-sale";
import type { CashSaleItem } from "../../mobile/src/cash-sale-types";

const MILK: CashSaleItem = {
  productId: "p-buffalo",
  code: "B",
  name: "Buffalo Milk",
  unit: "Litre",
  rate: 70,
  quantity: 1,
  amount: 70,
};

// Production shape: every vehicle runs exactly two rounds a day.
const MORNING = "route-morning";
const EVENING = "route-evening";

beforeEach(() => {
  __reset();
});

describe("cash sale sessions", () => {
  it("keeps a sale on its own round and date", async () => {
    await addCashSaleEntry(MORNING, "2026-08-19", [MILK]);
    await addCashSaleEntry(EVENING, "2026-08-19", [MILK]);

    expect(await getCashSaleEntries(MORNING, "2026-08-19")).toHaveLength(1);
    expect(await getCashSaleEntries(EVENING, "2026-08-19")).toHaveLength(1);
    expect(await getCashSaleEntries(MORNING, "2026-08-18")).toHaveLength(0);
  });

  it("returns the newest sale first", async () => {
    await addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 1 }]);
    await addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 2 }]);

    const entries = await getCashSaleEntries(MORNING, "2026-08-19");

    expect(entries[0].items[0].quantity).toBe(2);
  });
});

describe("reading never destroys", () => {
  it("does not lose a sale saved while a read is in flight", async () => {
    // The disappearing-sale bug. Reading used to prune and write the whole
    // store back, so a read that began before a save and finished after it
    // overwrote the store with its own stale snapshot.
    await addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 1 }]);

    __setDelay(5);
    const read = getCashSaleEntries(MORNING, "2026-08-19");
    const save = addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 9 }]);
    await Promise.all([read, save]);
    __setDelay(0);

    const entries = await getCashSaleEntries(MORNING, "2026-08-19");

    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.items[0].quantity === 9)).toBe(true);
  });

  it("survives many overlapping saves without dropping one", async () => {
    __setDelay(1);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: index + 1 }]),
      ),
    );
    __setDelay(0);

    const entries = await getCashSaleEntries(MORNING, "2026-08-19");

    expect(entries).toHaveLength(12);
  });

  it("leaves a read-only view of an old session untouched on disk", async () => {
    await addCashSaleEntry(MORNING, "2026-08-19", [MILK]);

    await getCashSaleEntries(MORNING, "2026-08-18");
    await getCashSaleEntries(EVENING, "2026-08-19");

    expect(await getCashSaleEntries(MORNING, "2026-08-19")).toHaveLength(1);
  });
});

describe("retention", () => {
  it("keeps a full day of rounds plus older ones, so a live session is never evicted", async () => {
    // A vehicle runs a morning and an evening round each day, so a two-session
    // budget was spent by a single ordinary day — glancing at yesterday was
    // enough to evict a round still being worked.
    for (const date of ["2026-08-17", "2026-08-18", "2026-08-19"]) {
      await addCashSaleEntry(MORNING, date, [MILK]);
      await addCashSaleEntry(EVENING, date, [MILK]);
    }

    expect(await getCashSaleEntries(MORNING, "2026-08-19")).toHaveLength(1);
    expect(await getCashSaleEntries(EVENING, "2026-08-19")).toHaveLength(1);
    expect(await getCashSaleEntries(MORNING, "2026-08-17")).toHaveLength(1);
  });

  it("ranks rounds by their own date, not by when a sale was typed in", async () => {
    for (const date of ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"]) {
      await addCashSaleEntry(MORNING, date, [MILK]);
    }
    // A sale remembered late for the oldest round. This gives that round the
    // newest timestamp on the device — under the old createdAt ranking it
    // then counted as the freshest session and displaced a newer round.
    await addCashSaleEntry(MORNING, "2026-08-14", [MILK]);

    // A seventh session forces one eviction. It should be the 14th, which is
    // the oldest ROUND, regardless of it holding the newest sale.
    await addCashSaleEntry(MORNING, "2026-08-20", [MILK]);

    expect(await getCashSaleEntries(MORNING, "2026-08-14")).toHaveLength(0);
    expect(await getCashSaleEntries(MORNING, "2026-08-15")).toHaveLength(1);
    expect(await getCashSaleEntries(MORNING, "2026-08-20")).toHaveLength(1);
  });

  it("still drops the oldest rounds rather than growing without bound", async () => {
    for (const date of ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18"]) {
      await addCashSaleEntry(MORNING, date, [MILK]);
      await addCashSaleEntry(EVENING, date, [MILK]);
    }
    // Writing again is what prunes; the 15th falls outside the six newest.
    await addCashSaleEntry(MORNING, "2026-08-19", [MILK]);

    expect(await getCashSaleEntries(MORNING, "2026-08-15")).toHaveLength(0);
    expect(await getCashSaleEntries(MORNING, "2026-08-19")).toHaveLength(1);
  });
});

describe("summariseCashSales", () => {
  it("adds up per product and overall", async () => {
    await addCashSaleEntry(MORNING, "2026-08-19", [
      { ...MILK, quantity: 2, amount: 140 },
      { ...MILK, productId: "p-lassi", code: "L", name: "Lassi", quantity: 1, amount: 60 },
    ]);
    await addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 1, amount: 70 }]);

    const totals = summariseCashSales(await getCashSaleEntries(MORNING, "2026-08-19"));

    expect(totals.entryCount).toBe(2);
    expect(totals.totalAmount).toBe(270);
    expect(totals.products.find((product) => product.productId === "p-buffalo")).toMatchObject({
      quantity: 3,
      name: "Buffalo Milk",
    });
  });
});

describe("deleteCashSaleEntry", () => {
  it("removes only the entry asked for", async () => {
    const keep = await addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 1 }]);
    const drop = await addCashSaleEntry(MORNING, "2026-08-19", [{ ...MILK, quantity: 2 }]);

    await deleteCashSaleEntry(drop.id);
    const entries = await getCashSaleEntries(MORNING, "2026-08-19");

    expect(entries.map((entry) => entry.id)).toEqual([keep.id]);
  });
});
