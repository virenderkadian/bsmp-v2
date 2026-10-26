import { describe, expect, it } from "vitest";
import {
  cellText,
  guessColumnIndex,
  parseStatementAmount,
  parseStatementDate,
} from "@/lib/bank-statement-parsing";

describe("parseStatementDate", () => {
  it("reads a real Date cell", () => {
    expect(parseStatementDate(new Date("2027-01-15T00:00:00.000Z"))).toBe("2027-01-15");
  });

  it("reads YYYY-MM-DD text", () => {
    expect(parseStatementDate("2027-1-5")).toBe("2027-01-05");
  });

  it("reads DD/MM/YYYY text", () => {
    expect(parseStatementDate("15/01/2027")).toBe("2027-01-15");
  });

  it("reads DD-MM-YYYY text", () => {
    expect(parseStatementDate("15-01-2027")).toBe("2027-01-15");
  });

  it("reads DD-Mon-YYYY text", () => {
    expect(parseStatementDate("07-Jan-2027")).toBe("2027-01-07");
  });

  it("returns null for unrecognisable text instead of guessing", () => {
    expect(parseStatementDate("not a date")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
    expect(parseStatementDate(undefined)).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("reads a plain number", () => {
    expect(parseStatementAmount(1917)).toBe(1917);
  });

  it("strips currency symbols and thousands separators", () => {
    expect(parseStatementAmount("₹1,917.00")).toBe(1917);
  });

  it("treats a parenthesised debit the same as a positive amount", () => {
    expect(parseStatementAmount("(1,200.00)")).toBe(1200);
  });

  it("returns null for blank or zero amounts", () => {
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount(0)).toBeNull();
    expect(parseStatementAmount("0.00")).toBeNull();
  });
});

describe("cellText", () => {
  it("passes a plain value through unchanged", () => {
    expect(cellText("hello")).toBe("hello");
    expect(cellText(42)).toBe(42);
  });

  it("unwraps a formula cell to its computed result", () => {
    expect(cellText({ formula: "=A1+A2", result: 1200 })).toBe(1200);
  });

  it("flattens rich text runs into plain text", () => {
    expect(cellText({ richText: [{ text: "NEFT-" }, { text: "REF001" }] })).toBe("NEFT-REF001");
  });
});

describe("guessColumnIndex", () => {
  it("finds a header containing one of the given keywords", () => {
    expect(guessColumnIndex(["Txn Date", "Narration", "Credit"], ["credit", "deposit", "amount"])).toBe(2);
  });

  it("returns -1 when nothing matches", () => {
    expect(guessColumnIndex(["Foo", "Bar"], ["credit", "amount"])).toBe(-1);
  });
});
