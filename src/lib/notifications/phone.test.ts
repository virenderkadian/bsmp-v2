import { describe, expect, it } from "vitest";
import { normalizeIndianMobile, toWhatsAppChatId } from "@/lib/notifications/phone";

const ok = (raw: string) => {
  const result = normalizeIndianMobile(raw);
  if (!result.ok) throw new Error(`expected ${raw} to normalize, got: ${result.reason}`);
  return result.msisdn;
};

const reason = (raw: string | null | undefined) => {
  const result = normalizeIndianMobile(raw);
  if (result.ok) throw new Error(`expected ${raw} to be rejected, got: ${result.msisdn}`);
  return result.reason;
};

describe("normalizeIndianMobile — shapes staff actually type", () => {
  it("accepts a bare 10-digit number", () => {
    expect(ok("9812345678")).toBe("919812345678");
  });

  it("accepts a leading zero", () => {
    expect(ok("09812345678")).toBe("919812345678");
  });

  it("accepts a 91 country code", () => {
    expect(ok("919812345678")).toBe("919812345678");
  });

  it("accepts +91 with spaces and dashes", () => {
    expect(ok("+91 98123-45678")).toBe("919812345678");
  });

  it("accepts a number wrapped in brackets", () => {
    expect(ok("(+91) 9812345678")).toBe("919812345678");
  });
});

describe("normalizeIndianMobile — rejections", () => {
  it("rejects null and empty, the common case for a customer with no number on file", () => {
    expect(reason(null)).toBe("No mobile number");
    expect(reason(undefined)).toBe("No mobile number");
    expect(reason("   ")).toBe("No mobile number");
  });

  it("rejects text with no digits in it", () => {
    expect(reason("n/a")).toBe("Mobile number has no digits");
  });

  it("rejects a landline, which cannot receive WhatsApp", () => {
    expect(reason("1262234567")).toBe("Not a valid Indian mobile number");
  });

  it("rejects a toll-free service number", () => {
    expect(reason("1800123456")).toBe("Not a valid Indian mobile number");
  });

  it("rejects a number that is too short to be dialable", () => {
    expect(reason("98123")).toMatch(/Unrecognised number format/);
  });

  it("rejects a too-long number rather than truncating it — truncating could message a stranger", () => {
    expect(reason("9812345678901234")).toMatch(/Unrecognised number format/);
  });

  it("rejects a 12-digit number that is not an Indian country code", () => {
    expect(reason("449812345678")).toMatch(/Unrecognised number format/);
  });
});

describe("toWhatsAppChatId", () => {
  it("builds the individual-chat address OpenWA expects", () => {
    expect(toWhatsAppChatId("919812345678")).toBe("919812345678@c.us");
  });
});
