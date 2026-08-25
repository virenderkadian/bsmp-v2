import { describe, expect, it } from "vitest";
import { localDateStr, todayStr } from "../../mobile/src/local-date";

// The driver app's notion of "today" drives the route sheet's date, the
// round-completion flag and the cash sale session. It used to be
// toISOString().slice(0, 10) — UTC — so in India (UTC+5:30) the day rolled
// over at 05:30 local rather than at midnight.
describe("localDateStr", () => {
  it("reads a pre-dawn moment as the day it is locally, not the UTC day", () => {
    // 04:30 on 19 Aug in a UTC+5:30 device is 23:00 UTC on 18 Aug. The old
    // UTC slice called this the 18th, so a cash sale recorded then vanished
    // from the round at 05:30 when the UTC date caught up.
    const preDawn = new Date(2026, 7, 19, 4, 30, 0);

    expect(localDateStr(preDawn)).toBe("2026-08-19");
  });

  it("stays on the same day late at night", () => {
    expect(localDateStr(new Date(2026, 7, 19, 23, 45, 0))).toBe("2026-08-19");
  });

  it("rolls over at local midnight", () => {
    expect(localDateStr(new Date(2026, 7, 19, 23, 59, 59))).toBe("2026-08-19");
    expect(localDateStr(new Date(2026, 7, 20, 0, 0, 1))).toBe("2026-08-20");
  });

  it("zero-pads month and day", () => {
    expect(localDateStr(new Date(2026, 0, 5, 9, 0, 0))).toBe("2026-01-05");
  });

  it("agrees with the device's own calendar day", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;

    expect(todayStr()).toBe(expected);
  });
});
