import { describe, expect, it } from "vitest";
// The sender agent is plain dependency-free ESM so it can run on a bare Node
// install on the office PC. Its pacing policy is pure, so it is tested here
// with the rest of the project rather than shipping untested.
import {
  isWithinSendingWindow,
  minutesIntoDay,
  msUntilWindowOpens,
  nextDelayMs,
  remainingToday,
  shouldTripBreaker,
} from "../../agent/pacing.js";

const IST = 330;
const window = { startHour: 9, endHour: 21, utcOffsetMinutes: IST };

// 2026-08-29T04:00:00Z is 09:30 IST — just inside a 9am-9pm window.
const at = (iso: string) => new Date(iso);

describe("minutesIntoDay", () => {
  it("shifts UTC into the configured offset", () => {
    expect(minutesIntoDay(at("2026-08-29T00:00:00Z"), IST)).toBe(5 * 60 + 30);
  });

  it("wraps past midnight correctly", () => {
    // 19:00 UTC is 00:30 IST the next day.
    expect(minutesIntoDay(at("2026-08-29T19:00:00Z"), IST)).toBe(30);
  });
});

describe("isWithinSendingWindow", () => {
  it("sends at 09:30 IST", () => {
    expect(isWithinSendingWindow(at("2026-08-29T04:00:00Z"), window)).toBe(true);
  });

  it("does not send at 08:00 IST, before the window opens", () => {
    expect(isWithinSendingWindow(at("2026-08-29T02:30:00Z"), window)).toBe(false);
  });

  it("does not send at 21:30 IST, after it closes", () => {
    expect(isWithinSendingWindow(at("2026-08-29T16:00:00Z"), window)).toBe(false);
  });

  it("does not send in the middle of the night — the case that gets people blocked", () => {
    // 21:00 UTC = 02:30 IST.
    expect(isWithinSendingWindow(at("2026-08-29T21:00:00Z"), window)).toBe(false);
  });

  it("treats the closing hour as exclusive, so 21:00 IST exactly is already shut", () => {
    expect(isWithinSendingWindow(at("2026-08-29T15:30:00Z"), window)).toBe(false);
  });
});

describe("msUntilWindowOpens", () => {
  it("is zero while sending is allowed", () => {
    expect(msUntilWindowOpens(at("2026-08-29T04:00:00Z"), window)).toBe(0);
  });

  it("waits until 9am when it is early morning", () => {
    // 02:30 UTC = 08:00 IST, so one hour to wait.
    expect(msUntilWindowOpens(at("2026-08-29T02:30:00Z"), window)).toBe(60 * 60_000);
  });

  it("waits overnight when the window has already closed", () => {
    // 16:00 UTC = 21:30 IST; next open is 09:00 IST, 11.5 hours later.
    expect(msUntilWindowOpens(at("2026-08-29T16:00:00Z"), window)).toBe(11.5 * 60 * 60_000);
  });
});

describe("nextDelayMs", () => {
  const pacing = { minSeconds: 20, maxSeconds: 30 };

  it("returns the low end when random is 0", () => {
    expect(nextDelayMs(pacing, () => 0)).toBe(20_000);
  });

  it("returns the high end when random is 1", () => {
    expect(nextDelayMs(pacing, () => 1)).toBe(30_000);
  });

  it("stays within the configured range across many draws", () => {
    for (let i = 0; i < 200; i += 1) {
      const delay = nextDelayMs(pacing);
      expect(delay).toBeGreaterThanOrEqual(20_000);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });

  it("varies rather than returning a fixed interval — a constant gap is a bot signature", () => {
    const draws = new Set(Array.from({ length: 50 }, () => nextDelayMs(pacing)));
    expect(draws.size).toBeGreaterThan(1);
  });

  it("tolerates min and max being given the wrong way round", () => {
    expect(nextDelayMs({ minSeconds: 30, maxSeconds: 20 }, () => 0)).toBe(20_000);
  });
});

describe("remainingToday", () => {
  it("counts down from the daily cap", () => {
    expect(remainingToday({ dailyCap: 1200, warmupCap: Infinity, sentToday: 200 })).toBe(1000);
  });

  it("lets the warm-up cap win while it is lower", () => {
    expect(remainingToday({ dailyCap: 1200, warmupCap: 200, sentToday: 50 })).toBe(150);
  });

  it("never goes negative once the cap is passed", () => {
    expect(remainingToday({ dailyCap: 1200, warmupCap: Infinity, sentToday: 1500 })).toBe(0);
  });

  it("falls back to the daily cap when no warm-up is configured", () => {
    expect(remainingToday({ dailyCap: 800, warmupCap: undefined, sentToday: 100 })).toBe(700);
  });
});

describe("shouldTripBreaker", () => {
  it("holds below the threshold", () => {
    expect(shouldTripBreaker({ consecutiveFailures: 7, threshold: 8 })).toBe(false);
  });

  it("trips at the threshold", () => {
    expect(shouldTripBreaker({ consecutiveFailures: 8, threshold: 8 })).toBe(true);
  });
});
