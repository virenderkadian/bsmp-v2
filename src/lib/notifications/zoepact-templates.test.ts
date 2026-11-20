import { describe, expect, it } from "vitest";
import {
  buildRatesText, buildRatesTextHindi, deliveryNoticeValues, hindiUnit, isSingleLine, monthlyBillLinkValues, monthNames, paymentReminderValues,
  rateChangeValues, toSingleLine, ZOEPACT_TEMPLATES, zoepactVariableSchemas,
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

describe("rate change notice", () => {
  it("puts any number of products on one line, whole rupees plain and paise kept", () => {
    expect(buildRatesText([{ name: "Milk", unit: "litre", oldRate: 60, newRate: 62 }])).toBe("Milk (per litre): ₹60 → ₹62");
    expect(
      buildRatesText([
        { name: "Full cream milk", unit: "litre", oldRate: "60.00", newRate: "62.50" },
        { name: "Paneer", unit: "kg", oldRate: 320, newRate: 340 },
        { name: "Ghee", oldRate: 650, newRate: 680 },
      ]),
    ).toBe("Full cream milk (per litre): ₹60 → ₹62.50; Paneer (per kg): ₹320 → ₹340; Ghee: ₹650 → ₹680");
  });

  it("never lets a product name break the single-line rule", () => {
    const text = buildRatesText([{ name: "Toned\nmilk\t  ", unit: "litre", oldRate: 50, newRate: 52 }]);
    expect(isSingleLine(text)).toBe(true);
    expect(text).toBe("Toned milk (per litre): ₹50 → ₹52");
  });

  it("fills the four slots: the date twice, the Hindi products, then the English products", () => {
    expect(rateChangeValues({ effectiveDate: "1 December 2026", ratesTextHi: "दूध: ₹60 → ₹62", ratesTextEn: "Milk: ₹60 → ₹62" })).toEqual([
      "1 December 2026", "दूध: ₹60 → ₹62", "1 December 2026", "Milk: ₹60 → ₹62",
    ]);
    expect(ZOEPACT_TEMPLATES.rate_change_notice_v1.slots).toBe(4);
  });

  it("accepts a normal notice and refuses a multi-line, empty or oversized one", () => {
    const schema = zoepactVariableSchemas.rate_change_notice_v1;
    const ok = { effectiveDate: "1 December 2026", ratesTextHi: "दूध: ₹60 → ₹62", ratesTextEn: "Milk: ₹60 → ₹62" };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, ratesTextEn: "Milk: ₹60\nPaneer: ₹320" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, ratesTextHi: "दूध\nपनीर" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, effectiveDate: "" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, ratesTextEn: "x".repeat(401) }).success).toBe(false);
    // Both languages are required.
    expect(schema.safeParse({ effectiveDate: "1 Dec", ratesTextEn: "Milk" }).success).toBe(false);
  });
});

describe("delivery notice", () => {
  it("fills the four slots: date, Hindi message, date, English message", () => {
    expect(deliveryNoticeValues({ date: "14 November 2026", messageHi: "सुबह 8 बजे के बाद", messageEn: "after 8 am" })).toEqual([
      "14 November 2026", "सुबह 8 बजे के बाद", "14 November 2026", "after 8 am",
    ]);
  });

  it("requires both messages and keeps each to one line", () => {
    const schema = zoepactVariableSchemas.delivery_notice_v1;
    expect(schema.safeParse({ date: "14 Nov", messageHi: "छुट्टी", messageEn: "Holiday" }).success).toBe(true);
    expect(schema.safeParse({ date: "14 Nov", messageHi: "", messageEn: "Holiday" }).success).toBe(false);
    expect(schema.safeParse({ date: "14 Nov", messageHi: "छुट्टी", messageEn: "line one\nline two" }).success).toBe(false);
  });
});

describe("single-line rule", () => {
  it("rejects what WhatsApp rejects and tidies pasted text", () => {
    expect(isSingleLine("a b")).toBe(true);
    expect(isSingleLine("a\nb")).toBe(false);
    expect(isSingleLine("a\tb")).toBe(false);
    expect(isSingleLine("a     b")).toBe(false);
    expect(toSingleLine("  a \n\n b\t c  ")).toBe("a b c");
  });
});

describe("rate change in Hindi and English", () => {
  it("shows each product in Hindi in the Hindi line and in English in the English line", () => {
    const items = [
      { name: "BUFFALO MILK", nameHi: "भैंस का दूध", unit: "LITRE", oldRate: 85, newRate: 90 },
      { name: "Paneer", nameHi: "पनीर", unit: "kg", oldRate: 320, newRate: 340 },
    ];
    expect(buildRatesTextHindi(items)).toBe("भैंस का दूध (प्रति लीटर): ₹85 → ₹90; पनीर (प्रति किलो): ₹320 → ₹340");
    expect(buildRatesText(items)).toBe("BUFFALO MILK (per LITRE): ₹85 → ₹90; Paneer (per kg): ₹320 → ₹340");
  });

  it("falls back to the English name when no Hindi name is given, and lets a Hindi unit be typed", () => {
    expect(buildRatesTextHindi([{ name: "Ghee", unit: "kg", oldRate: 650, newRate: 680 }])).toBe("Ghee (प्रति किलो): ₹650 → ₹680");
    expect(buildRatesTextHindi([{ name: "Curd", nameHi: "दही", unit: "cup", unitHi: "कप", oldRate: 20, newRate: 22 }])).toBe("दही (प्रति कप): ₹20 → ₹22");
  });

  it("hides the unit in both languages when there is none", () => {
    expect(buildRatesText([{ name: "Eggs", oldRate: 6, newRate: 7 }])).toBe("Eggs: ₹6 → ₹7");
    expect(buildRatesTextHindi([{ name: "Eggs", nameHi: "अंडे", oldRate: 6, newRate: 7 }])).toBe("अंडे: ₹6 → ₹7");
  });

  it("translates the common units and leaves an unknown one as typed", () => {
    expect(hindiUnit("Litre")).toBe("लीटर");
    expect(hindiUnit(" KG ")).toBe("किलो");
    expect(hindiUnit("gm")).toBe("ग्राम");
    expect(hindiUnit("bottle")).toBe("bottle");
  });

  it("keeps a Hindi name to one line", () => {
    expect(isSingleLine(buildRatesTextHindi([{ name: "x", nameHi: "भैंस\nका दूध", unit: "litre", oldRate: 1, newRate: 2 }]))).toBe(true);
  });
});
