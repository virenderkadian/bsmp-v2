import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { checkDriverLoginRateLimit, getClientIp, recordDriverLoginAttempt } from "@/lib/driver-rate-limit";

// Exercises the real DB-backed limiter (no Redis/Upstash in this project —
// login volume is far too low to need one). Hits the real dev database, like
// every other integration test in this repo; each test uses a unique
// vehicleCode/ipAddress so runs never collide, and cleans up after itself.

function uniqueCode(label: string) {
  return `RL-TEST-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Two random octets instead of one — ~65,000 possible addresses instead of
// 254, so concurrent test runs (this file included) essentially never
// collide on the same IP. Just a string in a test-only ipAddress column, so
// there's no need to stay inside a real reserved range.
function uniqueIp() {
  const third = Math.floor(Math.random() * 255);
  const fourth = Math.floor(Math.random() * 254) + 1;
  return `203.0.${third}.${fourth}`;
}

const usedCodes: string[] = [];
const usedIps: string[] = [];

afterEach(async () => {
  await prisma.driverLoginAttempt.deleteMany({
    where: { OR: [{ vehicleCode: { in: usedCodes } }, { ipAddress: { in: usedIps } }] },
  });
  usedCodes.length = 0;
  usedIps.length = 0;
});

describe("checkDriverLoginRateLimit", () => {
  it("is not limited with no prior attempts", async () => {
    const code = uniqueCode("fresh");
    usedCodes.push(code);

    const result = await checkDriverLoginRateLimit(code, null);
    expect(result.limited).toBe(false);
  });

  it("locks a vehicle code out after 5 failed attempts within the window", async () => {
    const code = uniqueCode("vehicle-lock");
    usedCodes.push(code);

    for (let i = 0; i < 4; i++) {
      await recordDriverLoginAttempt(code, null, false);
    }
    expect((await checkDriverLoginRateLimit(code, null)).limited).toBe(false);

    await recordDriverLoginAttempt(code, null, false); // 5th failure
    const result = await checkDriverLoginRateLimit(code, null);
    expect(result.limited).toBe(true);
    if (result.limited) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("does not count successful attempts toward the vehicle lockout", async () => {
    const code = uniqueCode("success-exempt");
    usedCodes.push(code);

    for (let i = 0; i < 5; i++) {
      await recordDriverLoginAttempt(code, null, true);
    }
    expect((await checkDriverLoginRateLimit(code, null)).limited).toBe(false);
  });

  it("blocks a correct-PIN attempt while locked out (lockout is about volume, not correctness)", async () => {
    // The login route checks the rate limit BEFORE verifying the PIN — this
    // test documents that contract at the limiter level: once locked, the
    // caller must treat every attempt as blocked regardless of what the PIN
    // check would have returned.
    const code = uniqueCode("volume-not-correctness");
    usedCodes.push(code);

    for (let i = 0; i < 5; i++) {
      await recordDriverLoginAttempt(code, null, false);
    }
    const result = await checkDriverLoginRateLimit(code, null);
    expect(result.limited).toBe(true);
  });

  it("locks an IP out after 20 failed attempts across different vehicle codes", async () => {
    const ip = uniqueIp();
    usedIps.push(ip);
    const codes = Array.from({ length: 20 }, (_, i) => uniqueCode(`ip-rotate-${i}`));
    usedCodes.push(...codes);

    // Parallel, not sequential — each write is independent (order within the
    // window comes from the DB's own createdAt, not call order), and 20
    // awaited round trips in series against the real dev DB was blowing past
    // the test timeout on its own, with nothing to do with isolation.
    await Promise.all(codes.map((code) => recordDriverLoginAttempt(code, ip, false)));

    // A brand-new vehicle code from the same IP is still blocked — the IP
    // limit exists precisely to catch someone rotating codes.
    const freshCode = uniqueCode("ip-rotate-fresh");
    usedCodes.push(freshCode);
    const result = await checkDriverLoginRateLimit(freshCode, ip);
    expect(result.limited).toBe(true);
  });

  it("does not apply the IP limit to an unrelated IP", async () => {
    const busyIp = uniqueIp();
    const otherIp = uniqueIp();
    usedIps.push(busyIp, otherIp);
    const codes = Array.from({ length: 20 }, (_, i) => uniqueCode(`ip-isolated-${i}`));
    usedCodes.push(...codes);

    await Promise.all(codes.map((code) => recordDriverLoginAttempt(code, busyIp, false)));

    const freshCode = uniqueCode("ip-isolated-fresh");
    usedCodes.push(freshCode);
    const result = await checkDriverLoginRateLimit(freshCode, otherIp);
    expect(result.limited).toBe(false);
  });

  it("does not count an attempt from outside the 15-minute window", async () => {
    const code = uniqueCode("outside-window");
    usedCodes.push(code);
    const old = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago

    await prisma.driverLoginAttempt.createMany({
      data: Array.from({ length: 6 }, () => ({ vehicleCode: code, ipAddress: null, success: false, createdAt: old })),
    });

    const result = await checkDriverLoginRateLimit(code, null);
    expect(result.limited).toBe(false);
  });
});

describe("getClientIp", () => {
  it("reads the first entry of x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("returns null when the header is absent", () => {
    const request = new Request("https://example.com");
    expect(getClientIp(request)).toBeNull();
  });
});
