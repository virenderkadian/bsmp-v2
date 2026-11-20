import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const BILL = "3f2b8c1e-9d4a-4e7b-8a15-0c6d2f9e7b34";
const SECRET = "x".repeat(40);

describe("bill link tokens", () => {
  beforeEach(() => {
    process.env.DRIVER_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.DRIVER_JWT_SECRET;
    vi.resetModules();
  });

  it("round-trips a bill id, in a short URL-safe token", async () => {
    const { signBillLink, verifyBillLink } = await import("@/lib/bill-link");
    const token = signBillLink(BILL);
    expect(token).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(verifyBillLink(token)).toEqual({ ok: true, billId: BILL });
  });

  it("rejects a token with any character changed", async () => {
    const { signBillLink, verifyBillLink } = await import("@/lib/bill-link");
    const token = signBillLink(BILL);
    for (const index of [0, 10, 25, 47]) {
      const flipped = token.slice(0, index) + (token[index] === "A" ? "B" : "A") + token.slice(index + 1);
      expect(verifyBillLink(flipped), `char ${index}`).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("rejects the wrong length or junk without needing the secret check", async () => {
    const { verifyBillLink } = await import("@/lib/bill-link");
    for (const junk of ["", "abc", "x".repeat(47), "x".repeat(49), "!".repeat(48), "../../etc/passwd"]) {
      expect(verifyBillLink(junk)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("expires after the lifetime and not before", async () => {
    const { signBillLink, verifyBillLink, BILL_LINK_TTL_DAYS } = await import("@/lib/bill-link");
    const issued = Date.UTC(2026, 10, 20);
    const token = signBillLink(BILL, { now: issued });
    expect(verifyBillLink(token, issued + (BILL_LINK_TTL_DAYS - 1) * 86_400_000).ok).toBe(true);
    expect(verifyBillLink(token, issued + (BILL_LINK_TTL_DAYS + 1) * 86_400_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("is not valid under a different secret", async () => {
    const { signBillLink } = await import("@/lib/bill-link");
    const token = signBillLink(BILL);
    process.env.DRIVER_JWT_SECRET = "y".repeat(40);
    vi.resetModules();
    const { verifyBillLink } = await import("@/lib/bill-link");
    expect(verifyBillLink(token)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses to sign anything that is not a UUID", async () => {
    const { signBillLink } = await import("@/lib/bill-link");
    expect(() => signBillLink("not-a-uuid")).toThrow();
  });
});
