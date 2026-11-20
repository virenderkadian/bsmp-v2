import "server-only";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  createTemplate, listTemplates, submitTemplate, syncTemplates, type RemoteTemplate, type ZoepactFailure,
} from "@/lib/notifications/zoepact";
import { isZoepactTemplateKey, ZOEPACT_TEMPLATES, type ZoepactTemplateKey } from "@/lib/notifications/zoepact-templates";

// Server half of the Templates tab: which of OUR templates exist at Zoepact/Meta,
// in what state, and the two things an admin can do about it (submit, resubmit).
// Role checks live in the server actions that call this.

export type TemplateRow = {
  key: ZoepactTemplateKey;
  label: string;
  description: string;
  zoepactName: string;
  category: string;
  language: string;
  body: string;
  footer: string;
  buttons: string[];
  // not_created: nothing at Zoepact yet. unknown: Zoepact reports a status we don't recognise.
  status: "not_created" | "pending" | "approved" | "rejected" | "unknown";
  remoteId?: string;
  rejectionReason?: string;
};

export type TemplatesState =
  | { ok: true; rows: TemplateRow[]; notice?: string }
  | { ok: false; message: string };

function rowsFrom(remote: RemoteTemplate[]): TemplateRow[] {
  const byName = new Map(remote.map((template) => [template.name, template]));
  return (Object.entries(ZOEPACT_TEMPLATES) as Array<[ZoepactTemplateKey, (typeof ZOEPACT_TEMPLATES)[ZoepactTemplateKey]]>).map(
    ([key, definition]) => {
      const found = byName.get(definition.zoepactName);
      return {
        key,
        label: definition.label,
        description: definition.description,
        zoepactName: definition.zoepactName,
        category: definition.category,
        language: definition.language,
        body: definition.body,
        footer: definition.footer,
        buttons: ("buttons" in definition ? definition.buttons : []).map((button) => `${button.text} → ${button.value}`),
        status: found ? found.status : "not_created",
        remoteId: found?.id,
        rejectionReason: found?.rejectionReason,
      };
    },
  );
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
  const listed = await listTemplates();
  if (!listed.ok) {
    return { ok: false, message: describeFailure(listed) };
  }
  return { ok: true, rows: rowsFrom(listed.data) };
}

// Creates the template at Zoepact, which submits it to Meta in the same call.
export async function submitOurTemplate(input: { key: string; cityId: string | null }): Promise<TemplatesState> {
  if (!isZoepactTemplateKey(input.key)) {
    return { ok: false, message: "Unknown template." };
  }
  const definition = ZOEPACT_TEMPLATES[input.key];

  const listed = await listTemplates();
  if (!listed.ok) {
    return { ok: false, message: describeFailure(listed) };
  }

  const existing = listed.data.find((template) => template.name === definition.zoepactName);
  let notice: string;

  if (existing) {
    // Only a rejected template may be sent again; pending is already with Meta
    // and approved is final (an approved template can't be reworded).
    if (existing.status !== "rejected") {
      return { ok: true, rows: rowsFrom(listed.data), notice: `Already ${existing.status} — nothing to submit.` };
    }
    const resubmitted = await submitTemplate(existing.id);
    if (!resubmitted.ok) {
      return { ok: false, message: describeFailure(resubmitted) };
    }
    notice = `Resubmitted ${definition.zoepactName} to Meta for review.`;
  } else {
    const created = await createTemplate({
      name: definition.zoepactName,
      category: definition.category,
      language: definition.language,
      body: definition.body,
      footer: definition.footer,
      ...("buttons" in definition ? { buttons: definition.buttons.map((button) => ({ ...button })) } : {}),
    });
    if (!created.ok) {
      return { ok: false, message: describeFailure(created) };
    }
    notice = `Submitted ${definition.zoepactName} to Meta for review. Approval usually takes minutes to 24 hours.`;
  }

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "WhatsAppTemplate",
    entityId: definition.zoepactName,
    action: existing ? "RESUBMIT" : "SUBMIT",
    summary: notice,
  });

  const refreshed = await loadTemplates();
  return refreshed.ok ? { ...refreshed, notice } : refreshed;
}
