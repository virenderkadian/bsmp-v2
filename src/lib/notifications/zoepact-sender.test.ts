import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildZoepactSend, isInSendWindow, outcomeFor } from "@/lib/notifications/zoepact-sender";

const BILL = "3f2b8c1e-9d4a-4e7b-8a15-0c6d2f9e7b34";
const sign = (id: string) => `tok-${id.slice(0, 4)}`;

describe("send window", () => {
  // 09:00-20:00 India time; the instants are UTC.
  it("allows daytime IST and blocks the night", () => {
    expect(isInSendWindow(new Date("2026-11-20T03:30:00Z"))).toBe(true); //  09:00 IST
    expect(isInSendWindow(new Date("2026-11-20T14:29:00Z"))).toBe(true); //  19:59 IST
    expect(isInSendWindow(new Date("2026-11-20T14:30:00Z"))).toBe(false); // 20:00 IST
    expect(isInSendWindow(new Date("2026-11-20T21:00:00Z"))).toBe(false); // 02:30 IST
    expect(isInSendWindow(new Date("2026-11-20T03:29:00Z"))).toBe(false); // 08:59 IST
  });
});

describe("send window hours", () => {
  const morning = new Date("2026-11-20T00:30:00Z"); // 06:00 IST
  const night = new Date("2026-11-20T16:30:00Z"); //   22:00 IST

  it("can be widened without a code change", () => {
    expect(isInSendWindow(morning, { from: 9, until: 20 })).toBe(false);
    expect(isInSendWindow(morning, { from: 6, until: 21 })).toBe(true);
    expect(isInSendWindow(night, { from: 6, until: 21 })).toBe(false);
    expect(isInSendWindow(night, { from: 0, until: 24 })).toBe(true);
  });

  it("reads NOTIFICATIONS_SEND_FROM_HOUR / _UNTIL_HOUR, and ignores a bad value", () => {
    try {
      process.env.NOTIFICATIONS_SEND_FROM_HOUR = "6";
      process.env.NOTIFICATIONS_SEND_UNTIL_HOUR = "21";
      expect(isInSendWindow(morning)).toBe(true);

      process.env.NOTIFICATIONS_SEND_FROM_HOUR = "banana";
      process.env.NOTIFICATIONS_SEND_UNTIL_HOUR = "99";
      expect(isInSendWindow(morning)).toBe(false); // back to the 9-20 default
      expect(isInSendWindow(new Date("2026-11-20T06:00:00Z"))).toBe(true); // 11:30 IST
    } finally {
      delete process.env.NOTIFICATIONS_SEND_FROM_HOUR;
      delete process.env.NOTIFICATIONS_SEND_UNTIL_HOUR;
    }
  });
});

describe("buildZoepactSend", () => {
  it("builds the reminder from the stored month and amount", () => {
    const built = buildZoepactSend("payment_reminder_hi_en_v1", { month: 10, outstanding: "2040.00" }, sign);
    expect(built).toEqual({
      ok: true,
      input: { templateName: "bsmp_payment_reminder_v1", language: "hi", variables: ["अक्टूबर", "2,040.00", "October", "2,040.00"] },
    });
  });

  it("builds the bill with a signed token in the button, made at send time", () => {
    const built = buildZoepactSend("monthly_bill_link_v1", { customerName: "Ram", month: 3, amountDue: "1250.5", billId: BILL }, sign);
    expect(built).toMatchObject({
      ok: true,
      input: {
        templateName: "bsmp_monthly_bill_v1",
        variables: ["Ram", "मार्च", "1,250.50", "Ram", "March", "1,250.50"],
        buttonVariables: [{ index: 0, sub_type: "url", text: "tok-3f2b" }],
      },
    });
  });

  it("refuses unknown templates and variables that no longer fit", () => {
    expect(buildZoepactSend("monthly_bill_v1", {}, sign)).toMatchObject({ ok: false });
    expect(buildZoepactSend("payment_reminder_hi_en_v1", { month: 13, outstanding: "1" }, sign)).toMatchObject({ ok: false });
    expect(buildZoepactSend("monthly_bill_link_v1", { customerName: "", month: 3, amountDue: 1, billId: BILL }, sign)).toMatchObject({ ok: false });
    expect(buildZoepactSend("monthly_bill_link_v1", { customerName: "R", month: 3, amountDue: 1, billId: "nope" }, sign)).toMatchObject({ ok: false });
  });
});

describe("buildZoepactSend: notices", () => {
  it("builds a rate change with the products in Hindi, then in English", () => {
    const built = buildZoepactSend("rate_change_notice_v1", {
      effectiveDate: "1 December 2026",
      ratesTextHi: "दूध (प्रति लीटर): ₹60 → ₹62; पनीर (प्रति किलो): ₹320 → ₹340",
      ratesTextEn: "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340",
    }, sign);
    expect(built).toEqual({
      ok: true,
      input: {
        templateName: "bsmp_rate_change_v1",
        language: "hi",
        variables: [
          "1 December 2026", "दूध (प्रति लीटर): ₹60 → ₹62; पनीर (प्रति किलो): ₹320 → ₹340",
          "1 December 2026", "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340",
        ],
      },
    });
  });

  it("builds a delivery notice with a Hindi and an English message", () => {
    const built = buildZoepactSend("delivery_notice_v1", { date: "14 November 2026", messageHi: "आज अवकाश रहेगा", messageEn: "no delivery today" }, sign);
    expect(built).toMatchObject({ ok: true, input: { templateName: "bsmp_delivery_notice_v1", variables: ["14 November 2026", "आज अवकाश रहेगा", "14 November 2026", "no delivery today"] } });
  });

  it("refuses a stored notice that WhatsApp would reject", () => {
    expect(buildZoepactSend("rate_change_notice_v1", { effectiveDate: "1 Dec", ratesTextHi: "a", ratesTextEn: "a\nb" }, sign)).toMatchObject({ ok: false });
    expect(buildZoepactSend("delivery_notice_v1", { date: "1 Dec", messageHi: "", messageEn: "x" }, sign)).toMatchObject({ ok: false });
  });
});

describe("buildZoepactSend: delivery completed", () => {
  it("builds the six values from the stored date, products and total", () => {
    const built = buildZoepactSend("delivery_completed_v1", { date: "21 November 2026", itemsText: "Milk 2 ltr = ₹124", amount: "124.00" }, sign);
    expect(built).toEqual({
      ok: true,
      input: {
        templateName: "bsmp_delivery_completed_v1",
        language: "hi",
        variables: ["21 November 2026", "Milk 2 ltr = ₹124", "124.00", "21 November 2026", "Milk 2 ltr = ₹124", "124.00"],
      },
    });
  });

  it("refuses a stored update with a line break in the products", () => {
    expect(buildZoepactSend("delivery_completed_v1", { date: "21 Nov", itemsText: "a\nb", amount: "1" }, sign)).toMatchObject({ ok: false });
  });
});

describe("buildZoepactSend: payment received", () => {
  it("builds the six values from the stored amount, date and mode", () => {
    const built = buildZoepactSend("payment_received_v1", { amount: "1500.00", date: "21 November 2026", mode: "UPI", paymentId: BILL }, sign);
    expect(built).toEqual({
      ok: true,
      input: {
        templateName: "bsmp_payment_received_v1",
        language: "hi",
        variables: ["1,500.00", "21 November 2026", "UPI", "1,500.00", "21 November 2026", "UPI"],
      },
    });
  });
});

describe("outcomeFor", () => {
  const fail = (kind: "config" | "invalid" | "transient" | "ambiguous") => ({ ok: false as const, kind, message: "m" });

  it("records a send with its reference", () => {
    expect(outcomeFor("a", { ok: true, data: { messageId: "w1" } })).toEqual({ id: "a", ok: true, providerRef: "w1" });
  });

  it("never auto-retries a send that may already have gone out", () => {
    const outcome = outcomeFor("a", fail("ambiguous"));
    expect(outcome).toMatchObject({ ok: false, permanent: true });
    expect((outcome as { error: string }).error).toContain("UNCONFIRMED");
  });

  it("fails a bad message for good, retries a transient one, and hands back the work on a config fault", () => {
    expect(outcomeFor("a", fail("invalid"))).toMatchObject({ ok: false, permanent: true });
    expect(outcomeFor("a", fail("transient"))).toEqual({ id: "a", ok: false, error: "m" });
    expect(outcomeFor("a", fail("config"))).toMatchObject({ ok: false, released: true });
  });
});
