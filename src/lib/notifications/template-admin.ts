import "server-only";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  createTemplate, listTemplates, submitTemplate, syncTemplates, type RemoteTemplate, type ZoepactFailure,
} from "@/lib/notifications/zoepact";
import {
  builtInTemplate, listWordingVersions, saveWordingVersion, setActiveVersion,
} from "@/lib/notifications/template-wording";
import {
  buttonLabelOf, isZoepactTemplateKey, SLOT_HELP, ZOEPACT_TEMPLATES, type WordingInput, type ZoepactTemplateKey,
} from "@/lib/notifications/zoepact-templates";

// Server half of the Templates tab: which versions of each template exist at
// Zoepact/Meta, in what state, and what an admin can do about it — submit one, switch
// to an approved one, or write a new one. Role checks live in the server actions.

export type VersionRow = {
  // null for the built-in wording (version 1).
  versionId: string | null;
  version: number;
  zoepactName: string;
  body: string;
  footer: string;
  buttonText: string | null;
  status: "not_created" | "pending" | "approved" | "rejected" | "unknown";
  remoteId?: string;
  rejectionReason?: string;
  // The version messages are sent with right now.
  isActive: boolean;
  createdByName?: string | null;
  createdAt?: string;
};

export type TemplateRow = {
  key: ZoepactTemplateKey;
  label: string;
  description: string;
  category: string;
  language: string;
  // What each {{n}} means, for the editor.
  slotHelp: string[];
  // The button's label, for the template that has one (its link can't be edited).
  buttonLabel: string | null;
  // Newest first; the built-in wording is last.
  versions: VersionRow[];
};

export type TemplatesState =
  | { ok: true; rows: TemplateRow[]; notice?: string }
  | { ok: false; message: string };

type StoredVersion = Awaited<ReturnType<typeof listWordingVersions>>[number];

function rowsFrom(remote: RemoteTemplate[], stored: StoredVersion[]): TemplateRow[] {
  const byName = new Map(remote.map((template) => [template.name, template]));
  const statusOf = (name: string): Pick<VersionRow, "status" | "remoteId" | "rejectionReason"> => {
    const found = byName.get(name);
    return { status: found ? found.status : "not_created", remoteId: found?.id, rejectionReason: found?.rejectionReason };
  };

  return (Object.keys(ZOEPACT_TEMPLATES) as ZoepactTemplateKey[]).map((key) => {
    const definition = ZOEPACT_TEMPLATES[key];
    const mine = stored.filter((row) => row.templateKey === key);
    const builtIn = builtInTemplate(key);
    const anyActive = mine.some((row) => row.isActive);

    const versions: VersionRow[] = [
      ...mine.map((row) => ({
        versionId: row.id,
        version: row.version,
        zoepactName: row.zoepactName,
        body: row.body,
        footer: row.footer,
        buttonText: row.buttonText,
        ...statusOf(row.zoepactName),
        isActive: row.isActive,
        createdByName: row.createdByName,
        createdAt: row.createdAt.toISOString(),
      })),
      {
        versionId: null,
        version: 1,
        zoepactName: builtIn.zoepactName,
        body: builtIn.body,
        footer: builtIn.footer,
        buttonText: builtIn.buttonText,
        ...statusOf(builtIn.zoepactName),
        isActive: !anyActive,
      },
    ];

    return {
      key,
      label: definition.label,
      description: definition.description,
      category: definition.category,
      language: definition.language,
      slotHelp: SLOT_HELP[key],
      buttonLabel: buttonLabelOf(key),
      versions,
    };
  });
}

function describeFailure(failure: ZoepactFailure): string {
  if (failure.kind === "config") {
    return failure.message.includes("ZOEPACT_API_KEY")
      ? "The Zoepact API key isn't set on this environment (ZOEPACT_API_KEY)."
      : "Zoepact rejected the API key. Check ZOEPACT_API_KEY.";
  }
  return failure.message;
}

// Reads the current state. Asks Zoepact to pull Meta's latest decisions first, so
// "Refresh" really means refresh; a failed pull still falls through to the list.
export async function loadTemplates(): Promise<TemplatesState> {
  await syncTemplates();
  const [listed, stored] = await Promise.all([listTemplates(), listWordingVersions()]);
  if (!listed.ok) {
    return { ok: false, message: describeFailure(listed) };
  }
  return { ok: true, rows: rowsFrom(listed.data, stored) };
}

async function withNotice(notice: string): Promise<TemplatesState> {
  const refreshed = await loadTemplates();
  return refreshed.ok ? { ...refreshed, notice } : refreshed;
}

// The wording and button of one version, built-in or stored.
async function wordingOf(key: ZoepactTemplateKey, versionId: string | null) {
  if (versionId === null) {
    const builtIn = builtInTemplate(key);
    return { zoepactName: builtIn.zoepactName, body: builtIn.body, footer: builtIn.footer, buttonText: builtIn.buttonText, version: 1 };
  }
  const row = await prisma.whatsAppTemplateVersion.findUnique({ where: { id: versionId } });
  if (!row || row.templateKey !== key) return null;
  return { zoepactName: row.zoepactName, body: row.body, footer: row.footer, buttonText: row.buttonText, version: row.version };
}

// Sends one version to Meta for review. A version that was REJECTED is sent again;
// one already pending or approved is left alone.
export async function submitVersion(input: { key: string; versionId: string | null; cityId: string | null }): Promise<TemplatesState> {
  if (!isZoepactTemplateKey(input.key)) return { ok: false, message: "Unknown template." };
  const key = input.key;
  const definition = ZOEPACT_TEMPLATES[key];

  const wording = await wordingOf(key, input.versionId);
  if (!wording) return { ok: false, message: "That version doesn't exist." };

  const listed = await listTemplates();
  if (!listed.ok) return { ok: false, message: describeFailure(listed) };

  const existing = listed.data.find((template) => template.name === wording.zoepactName);
  let notice: string;

  if (existing) {
    if (existing.status !== "rejected") {
      return { ok: true, rows: rowsFrom(listed.data, await listWordingVersions()), notice: `Already ${existing.status} — nothing to submit.` };
    }
    const resubmitted = await submitTemplate(existing.id);
    if (!resubmitted.ok) return { ok: false, message: describeFailure(resubmitted) };
    notice = `Resubmitted ${wording.zoepactName} to Meta for review.`;
  } else {
    const buttons = "buttons" in definition
      ? definition.buttons.map((button) => ({ ...button, text: wording.buttonText || button.text }))
      : undefined;
    const created = await createTemplate({
      name: wording.zoepactName,
      category: definition.category,
      language: definition.language,
      body: wording.body,
      footer: wording.footer,
      ...(buttons ? { buttons } : {}),
    });
    if (!created.ok) return { ok: false, message: describeFailure(created) };
    notice = `Submitted ${wording.zoepactName} to Meta for review. Approval usually takes minutes to 24 hours.`;
  }

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "WhatsAppTemplate",
    entityId: wording.zoepactName,
    action: existing ? "RESUBMIT" : "SUBMIT",
    summary: notice,
  });
  return withNotice(notice);
}

// Saves reworded text as a new version. It is not used until it is approved and switched on.
export async function saveWording(input: {
  key: string;
  wording: WordingInput;
  cityId: string | null;
  actor: { id: string; name: string } | null;
}): Promise<TemplatesState> {
  if (!isZoepactTemplateKey(input.key)) return { ok: false, message: "Unknown template." };

  const saved = await saveWordingVersion({ key: input.key, wording: input.wording, actor: input.actor });
  if (!saved.ok) return { ok: false, message: saved.errors.join(" ") };

  const notice = `Saved version ${saved.row.version} as ${saved.row.zoepactName}. Submit it to Meta, and use it once it shows Approved.`;
  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "WhatsAppTemplate",
    entityId: saved.row.zoepactName,
    action: "CREATE_VERSION",
    summary: notice,
    after: { key: input.key, version: saved.row.version },
  });
  return withNotice(notice);
}

// Switches messages to a version — only one Meta has approved, because a send with an
// unapproved template is rejected for every customer. null switches back to the
// built-in wording (also only if that one is approved).
export async function activateTemplateVersion(input: { key: string; versionId: string | null; cityId: string | null }): Promise<TemplatesState> {
  if (!isZoepactTemplateKey(input.key)) return { ok: false, message: "Unknown template." };

  const wording = await wordingOf(input.key, input.versionId);
  if (!wording) return { ok: false, message: "That version doesn't exist." };

  const listed = await listTemplates();
  if (!listed.ok) return { ok: false, message: describeFailure(listed) };
  const remote = listed.data.find((template) => template.name === wording.zoepactName);
  if (remote?.status !== "approved") {
    return { ok: false, message: `${wording.zoepactName} isn't approved by Meta yet, so it can't be used. Refresh the status first.` };
  }

  await setActiveVersion(input.key, input.versionId);

  const notice = `Messages now use version ${wording.version} (${wording.zoepactName}).`;
  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "WhatsAppTemplate",
    entityId: wording.zoepactName,
    action: "USE_VERSION",
    summary: notice,
    after: { key: input.key, version: wording.version },
  });
  return withNotice(notice);
}
