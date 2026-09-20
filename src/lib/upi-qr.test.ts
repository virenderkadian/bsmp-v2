import { describe, expect, it } from "vitest";
import { buildUpiUri } from "@/lib/upi-qr";

// The URI is what a customer's phone reads, so it is the thing worth pinning
// down. Testing the PNG would only prove the QR library works.
describe("buildUpiUri", () => {
  it("pays the given id, with the amount and the customer's code", () => {
    expect(
      buildUpiUri("round9@bank", "BSMP Dairy", { amount: 1818, note: "BHCID0093 Sep 2026" }),
    ).toBe(
      "upi://pay?pa=round9%40bank&pn=BSMP%20Dairy&am=1818.00&tn=BHCID0093%20Sep%202026&cu=INR",
    );
  });

  it("always sends two decimals, whatever it is given", () => {
    expect(buildUpiUri("s@b", "X", { amount: "700" })).toContain("am=700.00");
    expect(buildUpiUri("s@b", "X", { amount: 1234.5 })).toContain("am=1234.50");
  });

  it("omits the amount when the customer is in credit", () => {
    // A negative closing balance is a real case — 29 Rohtak customers carry one
    // — and a negative amount is not a valid request. Those bills get a plain
    // QR rather than a broken one.
    expect(buildUpiUri("s@b", "X", { amount: -250 })).not.toContain("am=");
    expect(buildUpiUri("s@b", "X", { amount: 0 })).not.toContain("am=");
    expect(buildUpiUri("s@b", "X", { amount: "not a number" })).not.toContain("am=");
  });

  it("omits the note when there is none, and never sends an empty one", () => {
    expect(buildUpiUri("s@b", "X")).toBe("upi://pay?pa=s%40b&pn=X&cu=INR");
    expect(buildUpiUri("s@b", "X", { note: "" })).not.toContain("tn=");
  });

  it("keeps the customer code when a long note is trimmed", () => {
    // Some apps truncate the note, so the identifying part leads.
    const uri = buildUpiUri("s@b", "X", { note: "BHCID0093 " + "x".repeat(80) });
    expect(uri).toContain("tn=BHCID0093");
    expect(decodeURIComponent(uri.split("tn=")[1].split("&")[0]).length).toBe(40);
  });

  it("escapes an id or name that would otherwise break the query", () => {
    expect(buildUpiUri("a&b@bank", "Dairy & Co")).toBe(
      "upi://pay?pa=a%26b%40bank&pn=Dairy%20%26%20Co&cu=INR",
    );
  });
});
