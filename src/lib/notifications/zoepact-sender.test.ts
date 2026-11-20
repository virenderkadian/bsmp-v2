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
  it("builds a rate change from the date and the one-line product list", () => {
    const built = buildZoepactSend("rate_change_notice_v1", { effectiveDate: "1 December 2026", ratesText: "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340" }, sign);
    expect(built).toEqual({
      ok: true,
      input: {
        templateName: "bsmp_rate_change_v1",
        language: "hi",
        variables: [
          "1 December 2026", "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340",
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
    expect(buildZoepactSend("rate_change_notice_v1", { effectiveDate: "1 Dec", ratesText: "a\nb" }, sign)).toMatchObject({ ok: false });
    expect(buildZoepactSend("delivery_notice_v1", { date: "1 Dec", messageHi: "", messageEn: "x" }, sign)).toMatchObject({ ok: false });
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
