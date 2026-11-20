import "server-only";
import { Prisma, type WhatsAppTemplateVersion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buttonLabelOf, validateWording, versionName, ZOEPACT_TEMPLATES, type WordingInput, type ZoepactTemplateKey,
} from "@/lib/notifications/zoepact-templates";

// Which wording each template is sent with. The built-in wording (zoepact-templates.ts)
// is version 1; a row in WhatsAppTemplateVersion is a version somebody wrote in the app.
// With no active row for a template, the built-in wording is used, so an empty table
// changes nothing. See the model comment in schema.prisma for why each version is its
// own template at Meta.

export type EffectiveTemplate = {
  key: ZoepactTemplateKey;
  version: number;
  zoepactName: string;
  language: string;
  category: "utility" | "marketing";
  body: string;
  footer: string;
  buttonText: string | null;
  isDefault: boolean;
};

const KEYS = Object.keys(ZOEPACT_TEMPLATES) as ZoepactTemplateKey[];

export function builtInTemplate(key: ZoepactTemplateKey): EffectiveTemplate {
  const definition = ZOEPACT_TEMPLATES[key];
  return {
    key,
    version: 1,
    zoepactName: definition.zoepactName,
    language: definition.language,
    category: definition.category,
    body: definition.body,
    footer: definition.footer,
    buttonText: buttonLabelOf(key),
    isDefault: true,
  };
}

function isKey(value: string): value is ZoepactTemplateKey {
  return value in ZOEPACT_TEMPLATES;
}

// Prisma's code for "the table does not exist". Seen only if this code is deployed
// before its migration; the lookup below then falls back to the built-in wording, so a
// sender that must keep working never depends on the new table being there.
function tableMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

// One small query. Used by the sender on every run and by the screens' previews.
export async function loadActiveTemplates(): Promise<Record<ZoepactTemplateKey, EffectiveTemplate>> {
  let active: WhatsAppTemplateVersion[] = [];
  try {
    active = await prisma.whatsAppTemplateVersion.findMany({ where: { isActive: true } });
  } catch (error) {
    if (!tableMissing(error)) throw error;
  }
  const result = Object.fromEntries(KEYS.map((key) => [key, builtInTemplate(key)])) as Record<ZoepactTemplateKey, EffectiveTemplate>;

  for (const row of active) {
    if (!isKey(row.templateKey)) continue;
    const base = builtInTemplate(row.templateKey);
    result[row.templateKey] = {
      ...base,
      version: row.version,
      zoepactName: row.zoepactName,
      body: row.body,
      footer: row.footer,
      buttonText: row.buttonText ?? base.buttonText,
      isDefault: false,
    };
  }
  return result;
}

export async function listWordingVersions(): Promise<WhatsAppTemplateVersion[]> {
  try {
    return await prisma.whatsAppTemplateVersion.findMany({ orderBy: [{ templateKey: "asc" }, { version: "desc" }] });
  } catch (error) {
    if (tableMissing(error)) return [];
    throw error;
  }
}

export type SaveWordingResult = { ok: true; row: WhatsAppTemplateVersion } | { ok: false; errors: string[] };

// Saves reworded text as the next version. It is NOT in use until it is approved by
// Meta and switched on. Refuses wording Meta would reject (see validateWording).
export async function saveWordingVersion(input: {
  key: ZoepactTemplateKey;
  wording: WordingInput;
  actor: { id: string; name: string } | null;
}): Promise<SaveWordingResult> {
  const errors = validateWording(input.key, input.wording);
  if (errors.length > 0) return { ok: false, errors };

  const latest = await prisma.whatsAppTemplateVersion.findFirst({
    where: { templateKey: input.key },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = Math.max(1, latest?.version ?? 1) + 1;

  try {
    const row = await prisma.whatsAppTemplateVersion.create({
      data: {
        templateKey: input.key,
        version,
        zoepactName: versionName(input.key, version),
        body: input.wording.body.trim(),
        footer: input.wording.footer.trim(),
        buttonText: buttonLabelOf(input.key) !== null ? (input.wording.buttonText ?? "").trim() : null,
        createdById: input.actor?.id ?? null,
        createdByName: input.actor?.name ?? null,
      },
    });
    return { ok: true, row };
  } catch (error) {
    // Two people saved at the same moment and took the same version number.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, errors: ["Someone else saved a version at the same moment. Reload and try again."] };
    }
    throw error;
  }
}

// Makes one version the one messages are sent with; null means the built-in wording.
// One transaction, so there is never a moment with two active (the partial unique
// index in the migration is the backstop) or a gap where the old one is off and the
// new one isn't on yet.
export async function setActiveVersion(key: ZoepactTemplateKey, versionId: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (versionId) {
      const row = await tx.whatsAppTemplateVersion.findUnique({ where: { id: versionId }, select: { templateKey: true } });
      if (!row || row.templateKey !== key) throw new Error("That version doesn't belong to this template.");
    }
    await tx.whatsAppTemplateVersion.updateMany({ where: { templateKey: key, isActive: true }, data: { isActive: false } });
    if (versionId) {
      await tx.whatsAppTemplateVersion.update({ where: { id: versionId }, data: { isActive: true } });
    }
  });
}
