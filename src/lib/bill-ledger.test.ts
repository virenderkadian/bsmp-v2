import { describe, expect, it } from "vitest";
import { receivedAgainstOpenBill, type CustomerLedger } from "@/lib/bill-ledger";

describe("receivedAgainstOpenBill", () => {
  it("is 0 for a customer with no ledger entry", () => {
    expect(receivedAgainstOpenBill(undefined)).toBe(0);
  });

  it("returns all verified payments when nothing is locked yet", () => {
    const ledger: CustomerLedger = { totalVerified: 600, lockedPaid: 0 };
    expect(receivedAgainstOpenBill(ledger)).toBe(600);
  });

  it("subtracts payments already frozen into locked bills", () => {
    // 600 collected total, 600 frozen into last month's locked bill → the open
    // bill has collected nothing new yet.
    const ledger: CustomerLedger = { totalVerified: 600, lockedPaid: 600 };
    expect(receivedAgainstOpenBill(ledger)).toBe(0);
  });

  it("counts only the post-lock collections against the open bill", () => {
    // June locked with 600 paid; then 400 more comes in for July.
    const ledger: CustomerLedger = { totalVerified: 1000, lockedPaid: 600 };
    expect(receivedAgainstOpenBill(ledger)).toBe(400);
  });

  it("never goes negative if locked total somehow exceeds verified total", () => {
    const ledger: CustomerLedger = { totalVerified: 500, lockedPaid: 600 };
    expect(receivedAgainstOpenBill(ledger)).toBe(0);
  });
});
