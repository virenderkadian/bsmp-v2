import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadActiveTemplates, saveWordingVersion, setActiveVersion } from "@/lib/notifications/template-wording";
import { buildZoepactSend } from "@/lib/notifications/zoepact-sender";
import { ZOEPACT_TEMPLATES } from "@/lib/notifications/zoepact-templates";

// Runs against the real dev database, like outbox.test.ts: the parts worth testing are the
// ones a mock would hide (the version numbering, the single-active guarantee, the rollback
// to the built-in wording). The table is global, so every test cleans up the rows it made.

const db = new PrismaClient();
const KEY = "payment_reminder_hi_en_v1" as const;
const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Test Admin" };
const wording = { body: "Namaste. Month {{1}}, amount {{2}}. Also {{3}} and {{4}}. Thanks", footer: "Test Dairy" };

async function wipe() {
  await db.whatsAppTemplateVersion.deleteMany({ where: { templateKey: KEY } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("template wording versions", () => {
  it("sends the built-in wording when nothing has been written", async () => {
    const active = await loadActiveTemplates();
    expect(active[KEY]).toMatchObject({
      version: 1, isDefault: true, zoepactName: "bsmp_payment_reminder_v1", body: ZOEPACT_TEMPLATES[KEY].body,
    });
  });

  it("saves reworded text as version 2, then 3, under new names, and does not use it yet", async () => {
    const first = await saveWordingVersion({ key: KEY, wording, actor });
    const second = await saveWordingVersion({ key: KEY, wording: { ...wording, footer: "Other" }, actor });

    expect(first).toMatchObject({ ok: true, row: { version: 2, zoepactName: "bsmp_payment_reminder_v2", isActive: false, createdByName: "Test Admin" } });
    expect(second).toMatchObject({ ok: true, row: { version: 3, zoepactName: "bsmp_payment_reminder_v3" } });

    // Saving changes nothing about what customers get.
    expect((await loadActiveTemplates())[KEY].isDefault).toBe(true);
  });

  it("refuses wording Meta would reject, and saves nothing", async () => {
    const result = await saveWordingVersion({ key: KEY, wording: { body: "Only {{1}} here", footer: "x" }, actor });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toMatch(/Missing/);
    expect(await db.whatsAppTemplateVersion.count({ where: { templateKey: KEY } })).toBe(0);
  });

  it("switches to a version, and back to the built-in wording", async () => {
    const saved = await saveWordingVersion({ key: KEY, wording, actor });
    if (!saved.ok) throw new Error("save failed");

    await setActiveVersion(KEY, saved.row.id);
    expect((await loadActiveTemplates())[KEY]).toMatchObject({
      version: 2, isDefault: false, zoepactName: "bsmp_payment_reminder_v2", body: wording.body, footer: "Test Dairy",
    });

    await setActiveVersion(KEY, null);
    expect((await loadActiveTemplates())[KEY]).toMatchObject({ version: 1, isDefault: true });
  });

  it("only ever has one version in use: switching turns the old one off", async () => {
    const a = await saveWordingVersion({ key: KEY, wording, actor });
    const b = await saveWordingVersion({ key: KEY, wording: { ...wording, footer: "B" }, actor });
    if (!a.ok || !b.ok) throw new Error("save failed");

    await setActiveVersion(KEY, a.row.id);
    await setActiveVersion(KEY, b.row.id);

    const active = await db.whatsAppTemplateVersion.findMany({ where: { templateKey: KEY, isActive: true } });
    expect(active.map((row) => row.version)).toEqual([3]);
  });

  it("is backed by the database too: two in use at once is refused", async () => {
    const a = await saveWordingVersion({ key: KEY, wording, actor });
    const b = await saveWordingVersion({ key: KEY, wording: { ...wording, footer: "B" }, actor });
    if (!a.ok || !b.ok) throw new Error("save failed");

    await db.whatsAppTemplateVersion.update({ where: { id: a.row.id }, data: { isActive: true } });
    await expect(db.whatsAppTemplateVersion.update({ where: { id: b.row.id }, data: { isActive: true } })).rejects.toThrow();
  });

  it("refuses to switch to a version of a different template", async () => {
    const saved = await saveWordingVersion({ key: KEY, wording, actor });
    if (!saved.ok) throw new Error("save failed");
    await expect(setActiveVersion("delivery_notice_v1", saved.row.id)).rejects.toThrow(/doesn't belong/);
    await expect(setActiveVersion(KEY, "00000000-0000-4000-8000-000000000000")).rejects.toThrow();
  });
});

describe("the sender uses the version in use", () => {
  it("sends under the new template name, with the same blanks filled", () => {
    const sign = () => "tok";
    const built = buildZoepactSend(KEY, { month: 10, outstanding: "2040" }, sign, { zoepactName: "bsmp_payment_reminder_v2", language: "hi" });
    expect(built).toEqual({
      ok: true,
      input: { templateName: "bsmp_payment_reminder_v2", language: "hi", variables: ["अक्टूबर", "2,040.00", "October", "2,040.00"] },
    });
    expect(buildZoepactSend(KEY, { month: 10, outstanding: "2040" }, sign)).toMatchObject({ ok: true, input: { templateName: "bsmp_payment_reminder_v1" } });
  });
});
