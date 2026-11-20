import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessageStatus, getWalletBalance, sendTemplate } from "@/lib/notifications/zoepact";

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const base = { phone: "919876543210", templateName: "payment_reminder", language: "hi", variables: ["अक्टूबर", "2,040.00"] };

describe("zoepact client", () => {
  beforeEach(() => {
    process.env.ZOEPACT_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ZOEPACT_API_KEY;
  });

  it("sends the key in X-API-Key, never in the URL, with the documented body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: { message_id: "wamid.1" } }));
    const result = await sendTemplate(base);

    expect(result).toEqual({ ok: true, data: { messageId: "wamid.1" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://dash.zoepact.com/api/v1/messages/template");
    expect(String(url)).not.toContain("test-key");
    expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      phone: "919876543210", template_name: "payment_reminder", language: "hi", variables: ["अक्टूबर", "2,040.00"],
    });
  });

  it("passes document header media and button variables through", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: { id: 77 } }));
    const result = await sendTemplate({
      ...base,
      headerMedia: { type: "document", link: "https://x.test/b.pdf", filename: "b.pdf" },
      buttonVariables: [{ index: 0, sub_type: "url", text: "tok123" }],
    });

    expect(result).toEqual({ ok: true, data: { messageId: "77" } });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.header_media).toEqual({ type: "document", link: "https://x.test/b.pdf", filename: "b.pdf" });
    expect(body.button_variables).toEqual([{ index: 0, sub_type: "url", text: "tok123" }]);
  });

  it("still counts a send as done when the response carries no message id", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: {} }));
    expect(await sendTemplate(base)).toEqual({ ok: true, data: { messageId: undefined } });
  });

  it("never calls the API for a number or value it can already see is bad", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await sendTemplate({ ...base, phone: "+91 98765" })).ok).toBe(false);
    expect((await sendTemplate({ ...base, variables: ["अक्टूबर", " "] })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies failures by what the outbox should do", async () => {
    const cases: Array<[number, string]> = [[401, "config"], [403, "config"], [400, "invalid"], [404, "invalid"], [429, "transient"], [500, "ambiguous"]];
    for (const [status, kind] of cases) {
      vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(status, { success: false, message: "no" }));
      expect(await sendTemplate(base), `HTTP ${status}`).toMatchObject({ ok: false, kind });
    }
  });

  it("treats a dropped connection on a send as ambiguous (could have gone out) but on a read as transient", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    expect(await sendTemplate(base)).toMatchObject({ ok: false, kind: "ambiguous" });
    expect(await getMessageStatus("m1")).toMatchObject({ ok: false, kind: "transient" });
  });

  it("is a config failure, with no request, when the key is missing", async () => {
    delete process.env.ZOEPACT_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await sendTemplate(base)).toMatchObject({ ok: false, kind: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a message status and rejects one it does not know", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: { status: "Delivered" } }));
    expect(await getMessageStatus("m1")).toEqual({ ok: true, data: { status: "delivered", error: undefined } });

    vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: { status: "weird" } }));
    expect(await getMessageStatus("m1")).toMatchObject({ ok: false, kind: "transient" });
  });

  it("reads the wallet balance under the likely field names", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: { balance: "412.50" } }));
    expect(await getWalletBalance()).toEqual({ ok: true, data: { balance: 412.5 } });

    vi.spyOn(globalThis, "fetch").mockImplementation(() => reply(200, { success: true, data: { currency: "INR" } }));
    expect(await getWalletBalance()).toMatchObject({ ok: false });
  });
});
