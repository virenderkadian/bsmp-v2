import { beforeAll, describe, expect, it } from "vitest";
import {
  hashPin,
  signDriverToken,
  verifyDriverToken,
  verifyPin,
} from "@/lib/driver-auth";

beforeAll(() => {
  // getSecret() reads this lazily (at sign/verify time), so setting it here is
  // enough for the JWT round-trip below.
  process.env.DRIVER_JWT_SECRET ??= "test-secret-that-is-definitely-long-enough-0123456789";
});

describe("PIN hashing", () => {
  it("verifies the correct PIN and rejects a wrong one", () => {
    const stored = hashPin("4821");
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
  });

  it("produces a different salt (and hash) each time for the same PIN", () => {
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
  });

  it("rejects against a null or malformed stored hash", () => {
    expect(verifyPin("1234", null)).toBe(false);
    expect(verifyPin("1234", undefined)).toBe(false);
    expect(verifyPin("1234", "not-a-valid-hash")).toBe(false);
    expect(verifyPin("1234", "bcrypt$abc$def")).toBe(false);
  });
});

describe("driver JWT", () => {
  it("round-trips vehicleId + cityId", async () => {
    const token = await signDriverToken({ vehicleId: "veh-1", cityId: "city-1" });
    const payload = await verifyDriverToken(token);
    expect(payload).toEqual({ vehicleId: "veh-1", cityId: "city-1" });
  });

  it("rejects a tampered / garbage token", async () => {
    expect(await verifyDriverToken("garbage.token.value")).toBeNull();
    const token = await signDriverToken({ vehicleId: "veh-1", cityId: "city-1" });
    expect(await verifyDriverToken(`${token}tampered`)).toBeNull();
  });
});
