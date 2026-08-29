import { describe, expect, it } from "vitest";
import { checkSession } from "../../agent/openwa.js";

// OpenWA's SessionStatus values (src/modules/session/entities/session.entity.ts):
//   created · initializing · qr_ready · authenticating · ready · disconnected · failed
//
// Only `ready` can send. This is tested rather than assumed because the first
// implementation used a substring match — `/connected|authenticated|ready/i` —
// which reported BOTH "disconnected" (contains "connected") and "qr_ready"
// (contains "ready") as healthy. The consequence was not cosmetic: the agent
// would have started sending against a dead session, failed every message, and
// tripped the circuit breaker with a warning that the number looked restricted.
// That is precisely the false alarm checkSession exists to prevent.

function mockOpenWa(status: string | null, httpStatus = 200) {
  const server = { calls: 0 };
  globalThis.fetch = (async () => {
    server.calls += 1;
    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus,
      json: async () => (status === null ? {} : { status }),
    };
  }) as unknown as typeof fetch;
  return server;
}

const config = { baseUrl: "http://localhost:2785", apiKey: "k", sessionId: "s", timeoutMs: 1000 };

describe("checkSession — only 'ready' may send", () => {
  it("treats 'ready' as connected", async () => {
    mockOpenWa("ready");
    expect((await checkSession(config)).state).toBe("connected");
  });

  it("treats 'disconnected' as NOT connected, despite containing the word 'connected'", async () => {
    mockOpenWa("disconnected");
    expect((await checkSession(config)).state).toBe("disconnected");
  });

  it("treats 'qr_ready' as NOT connected, despite containing 'ready' — a QR means nobody has scanned", async () => {
    mockOpenWa("qr_ready");
    expect((await checkSession(config)).state).toBe("disconnected");
  });

  it("treats 'authenticating' as NOT connected — the scan is still in progress", async () => {
    mockOpenWa("authenticating");
    expect((await checkSession(config)).state).toBe("disconnected");
  });

  it.each(["created", "initializing", "failed"])("treats '%s' as NOT connected", async (status) => {
    mockOpenWa(status);
    expect((await checkSession(config)).state).toBe("disconnected");
  });

  it("is case-insensitive, since the API has returned upper-case values", async () => {
    mockOpenWa("READY");
    expect((await checkSession(config)).state).toBe("connected");
  });
});

describe("checkSession — distinguishing the failure modes", () => {
  it("reports a 404 as 'missing' so the agent exits rather than waiting forever for a QR nobody will scan", async () => {
    mockOpenWa(null, 404);
    expect((await checkSession(config)).state).toBe("missing");
  });

  it("reports any other HTTP error as 'unreachable', which is worth waiting out", async () => {
    mockOpenWa(null, 500);
    expect((await checkSession(config)).state).toBe("unreachable");
  });

  it("reports a connection failure as 'unreachable', not as a dead session", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:2785");
    }) as unknown as typeof fetch;

    const result = await checkSession(config);
    expect(result.state).toBe("unreachable");
    expect(result.detail).toContain("ECONNREFUSED");
  });

  it("does not crash when the API returns no status field at all", async () => {
    mockOpenWa(null);
    expect((await checkSession(config)).state).toBe("disconnected");
  });
});
