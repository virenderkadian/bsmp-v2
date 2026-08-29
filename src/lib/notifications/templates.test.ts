import { describe, expect, it } from "vitest";
import {
  buildUpiLink,
  formatMoney,
  getTemplateCategory,
  isTemplateKey,
  renderTemplate,
  TEMPLATES,
} from "@/lib/notifications/templates";

describe("formatMoney", () => {
  it("uses Indian digit grouping, not western", () => {
    expect(formatMoney(234000)).toBe("2,34,000.00");
  });

  it("accepts the string decimals Prisma hands back for Decimal columns", () => {
    expect(formatMoney("2340.5")).toBe("2,340.50");
  });

  it("renders a credit balance with its sign rather than dropping it", () => {
    expect(formatMoney(-3000)).toBe("-3,000.00");
  });

  it("falls back to zero instead of printing NaN to a customer", () => {
    expect(formatMoney("not a number")).toBe("0.00");
  });
});

describe("buildUpiLink", () => {
  it("pre-fills the amount so the customer does not type it", () => {
    const link = buildUpiLink("bsmp@okaxis", "BSMP Dairy", 2340);
    expect(link).toContain("pa=bsmp%40okaxis");
    expect(link).toContain("am=2340.00");
    expect(link).toContain("cu=INR");
  });

  it("omits the amount when the balance is zero or in credit, so the link still works", () => {
    expect(buildUpiLink("bsmp@okaxis", "BSMP Dairy", 0)).not.toContain("am=");
    expect(buildUpiLink("bsmp@okaxis", "BSMP Dairy", -500)).not.toContain("am=");
  });

  it("encodes a payee name containing spaces and punctuation", () => {
    expect(buildUpiLink("bsmp@okaxis", "BSMP Dairy & Sons")).toContain("pn=BSMP+Dairy+%26+Sons");
  });
});

const billVariables = {
  businessName: "BSMP Dairy",
  customerName: "Ramesh Kumar",
  customerCode: "C-1042",
  billingMonth: "August 2026",
  openingBalance: 340,
  deliveryAmount: 2780,
  paymentAmount: 780,
  closingBalance: 2340,
};

describe("renderTemplate — monthly_bill_v1", () => {
  it("includes the customer, the month, and every figure", () => {
    const text = renderTemplate("monthly_bill_v1", billVariables);

    expect(text).toContain("Ramesh Kumar (C-1042)");
    expect(text).toContain("August 2026");
    expect(text).toContain("2,780.00");
    expect(text).toContain("2,340.00");
  });

  it("wraps the figures in a monospace block so the columns line up in WhatsApp", () => {
    const text = renderTemplate("monthly_bill_v1", billVariables);
    expect(text.match(/```/g)).toHaveLength(2);
  });

  it("omits the UPI line entirely when no UPI id is configured for the city", () => {
    expect(renderTemplate("monthly_bill_v1", billVariables)).not.toContain("Pay by UPI");
  });

  it("includes the UPI line when one is supplied", () => {
    const text = renderTemplate("monthly_bill_v1", { ...billVariables, upiLink: "upi://pay?pa=x" });
    expect(text).toContain("Pay by UPI: upi://pay?pa=x");
  });

  it("accepts the string decimals Prisma returns, not just numbers", () => {
    const text = renderTemplate("monthly_bill_v1", {
      ...billVariables,
      closingBalance: "2340.00",
    });
    expect(text).toContain("2,340.00");
  });
});

describe("renderTemplate — rate_change_v1", () => {
  it("lists each product's old and new rate", () => {
    const text = renderTemplate("rate_change_v1", {
      businessName: "BSMP Dairy",
      customerName: "Ramesh Kumar",
      effectiveFrom: "1 September 2026",
      changes: [{ productName: "Full Cream Milk", oldRate: 62, newRate: 66, unit: "ltr" }],
    });

    expect(text).toContain("Full Cream Milk");
    expect(text).toContain("62.00 -> 66.00");
    expect(text).toContain("1 September 2026");
  });

  it("rejects a rate change with no changes in it", () => {
    expect(() =>
      renderTemplate("rate_change_v1", {
        businessName: "BSMP Dairy",
        customerName: "Ramesh Kumar",
        effectiveFrom: "1 September 2026",
        changes: [],
      }),
    ).toThrow(/Invalid variables/);
  });
});

describe("renderTemplate — validation", () => {
  it("refuses an unknown template rather than sending something empty", () => {
    expect(() => renderTemplate("no_such_template", {})).toThrow(/Unknown notification template/);
  });

  it("refuses variables missing a required field, so no message says 'undefined'", () => {
    const incomplete: Record<string, unknown> = { ...billVariables };
    delete incomplete.closingBalance;
    expect(() => renderTemplate("monthly_bill_v1", incomplete)).toThrow(/Invalid variables/);
  });

  it("refuses null variables (a row queued before its template existed)", () => {
    expect(() => renderTemplate("monthly_bill_v1", null)).toThrow(/Invalid variables/);
  });
});

describe("template categories", () => {
  it("classifies bills and reminders as UTILITY", () => {
    expect(getTemplateCategory("monthly_bill_v1")).toBe("UTILITY");
    expect(getTemplateCategory("payment_reminder_v1")).toBe("UTILITY");
    expect(getTemplateCategory("rate_change_v1")).toBe("UTILITY");
  });

  it("classifies the free-text notice as MARKETING, since its content is unconstrained", () => {
    expect(getTemplateCategory("notice_v1")).toBe("MARKETING");
  });

  it("returns null for an unknown template instead of guessing a category", () => {
    expect(getTemplateCategory("no_such_template")).toBeNull();
  });

  it("every registered template declares a category and a label", () => {
    for (const [key, definition] of Object.entries(TEMPLATES)) {
      expect(isTemplateKey(key)).toBe(true);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(["UTILITY", "MARKETING"]).toContain(definition.category);
    }
  });
});
