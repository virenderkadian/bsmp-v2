import { describe, expect, it } from "vitest";
import {
  monthlyBillLinkValues, monthNames, paymentReminderValues, ZOEPACT_TEMPLATES,
} from "@/lib/notifications/zoepact-templates";

const slotsIn = (text: string) => [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));

describe("zoepact templates", () => {
  it("number their slots 1..n with no gaps, and declare the right count", () => {
    for (const [key, template] of Object.entries(ZOEPACT_TEMPLATES)) {
      const found = [...new Set(slotsIn(template.body))].sort((a, b) => a - b);
      expect(found, key).toEqual(Array.from({ length: template.slots }, (_, index) => index + 1));
    }
  });

  it("use names Meta accepts and stay inside its length limits", () => {
    for (const [key, template] of Object.entries(ZOEPACT_TEMPLATES)) {
      expect(template.zoepactName, key).toMatch(/^[a-z0-9_]+$/);
      expect(template.body.length, key).toBeLessThanOrEqual(1024);
      expect(template.footer.length, key).toBeLessThanOrEqual(60);
      // Meta rejects a body that opens or closes with a variable.
      expect(template.body.trimStart().startsWith("{{"), key).toBe(false);
      expect(template.body.trimEnd().endsWith("}}"), key).toBe(false);
      for (const button of "buttons" in template ? template.buttons : []) {
        expect(button.text.length).toBeLessThanOrEqual(25);
      }
    }
  });

  it("fill the reminder's four slots: Hindi month, amount, English month, amount", () => {
    expect(paymentReminderValues({ month: 10, outstanding: "2040" })).toEqual(["अक्टूबर", "2,040.00", "October", "2,040.00"]);
    expect(paymentReminderValues({ month: 10, outstanding: 2040 })).toHaveLength(ZOEPACT_TEMPLATES.payment_reminder_hi_en_v1.slots);
  });

  it("fill the bill's six slots and hand back the button token separately", () => {
    const { variables, buttonToken } = monthlyBillLinkValues({ customerName: "Ram Kumar", month: 3, amountDue: 1250.5, token: "tok.en" });
    expect(variables).toEqual(["Ram Kumar", "मार्च", "1,250.50", "Ram Kumar", "March", "1,250.50"]);
    expect(variables).toHaveLength(ZOEPACT_TEMPLATES.monthly_bill_link_v1.slots);
    expect(buttonToken).toBe("tok.en");
  });

  it("name every month in both languages, and clamp an out-of-range month", () => {
    for (let month = 1; month <= 12; month += 1) {
      const { hi, en } = monthNames(month);
      expect(hi.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    }
    expect(monthNames(0).en).toBe("January");
    expect(monthNames(13).en).toBe("December");
  });
});
