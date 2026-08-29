import { z } from "zod";

// Message templates. Deliberately pure — no I/O, no Prisma, no env — so they
// unit-test like src/lib/monthly-bills-math.ts and can run either in the web
// app or in the office-PC sender agent from the same definitions.
//
// The outbox stores a template key plus its named variables, never a rendered
// string (see the NotificationOutbox comment in prisma/schema.prisma). Rendering
// happens here at send time. Variables arrive from a JSONB column, so every
// template validates its input at runtime rather than trusting the type.

// WhatsApp's Business Messaging Policy treats these very differently, and so
// should we. UTILITY is a transactional message about something the customer
// already has with us — a bill, a receipt, a service change. MARKETING is
// promotional, needs its own consent, and is the category that actually gets
// numbers banned. Keeping it on the template (not on the send screen) means the
// classification travels with the message and can't be mislabelled by a caller.
export type TemplateCategory = "UTILITY" | "MARKETING";

const money = z.union([z.number(), z.string()]);

// Indian digit grouping (2,34,000 rather than 234,000) — these are read by
// customers in India, not by an export.
const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | string): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(amount) ? inr.format(amount) : "0.00";
}

// Right-aligns amounts into a fixed-width column so the figures line up when
// WhatsApp renders the block as monospace. Without this the numbers stagger and
// the summary reads as a wall of text.
function row(label: string, value: string, width = 12): string {
  return `${label.padEnd(20)}${value.padStart(width)}`;
}

const RULE = "-".repeat(32);

// A UPI deep link the customer can tap to pay. Mirrors the URI built for the
// printed bill's QR code in src/lib/upi-qr.ts — same scheme and parameters, so
// paying from WhatsApp and paying from the paper bill behave identically.
// `am` is included here (the QR is generic) so the amount is pre-filled.
export function buildUpiLink(upiId: string, payeeName: string, amount?: number | string): string {
  const params = new URLSearchParams({ pa: upiId, pn: payeeName, cu: "INR" });

  if (amount !== undefined) {
    const value = typeof amount === "string" ? Number(amount) : amount;
    if (Number.isFinite(value) && value > 0) {
      params.set("am", value.toFixed(2));
    }
  }

  return `upi://pay?${params.toString()}`;
}

// ---- Template definitions ----

const monthlyBillVariables = z.object({
  businessName: z.string(),
  customerName: z.string(),
  customerCode: z.string(),
  billingMonth: z.string(),
  openingBalance: money,
  deliveryAmount: money,
  paymentAmount: money,
  closingBalance: money,
  upiLink: z.string().optional(),
  footerNote: z.string().optional(),
});

const rateChangeVariables = z.object({
  businessName: z.string(),
  customerName: z.string(),
  effectiveFrom: z.string(),
  changes: z
    .array(z.object({ productName: z.string(), oldRate: money, newRate: money, unit: z.string() }))
    .min(1),
  note: z.string().optional(),
});

const paymentReminderVariables = z.object({
  businessName: z.string(),
  customerName: z.string(),
  customerCode: z.string(),
  outstanding: money,
  asOf: z.string(),
  upiLink: z.string().optional(),
});

const noticeVariables = z.object({
  businessName: z.string(),
  customerName: z.string(),
  heading: z.string(),
  body: z.string(),
});

export type MonthlyBillVariables = z.infer<typeof monthlyBillVariables>;
export type RateChangeVariables = z.infer<typeof rateChangeVariables>;
export type PaymentReminderVariables = z.infer<typeof paymentReminderVariables>;
export type NoticeVariables = z.infer<typeof noticeVariables>;

type TemplateDefinition = {
  label: string;
  category: TemplateCategory;
  description: string;
  schema: z.ZodType;
  render: (variables: never) => string;
};

// Adding a message type is one entry here plus a way to select its audience —
// nothing in the outbox, the agent, or the pacing layer needs to change.
export const TEMPLATES = {
  monthly_bill_v1: {
    label: "Monthly bill",
    category: "UTILITY",
    description: "The month's delivery total, payments received, and closing balance.",
    schema: monthlyBillVariables,
    render: (v: MonthlyBillVariables) =>
      [
        `*${v.businessName}*`,
        `Bill for ${v.billingMonth}`,
        "",
        `${v.customerName} (${v.customerCode})`,
        "",
        "```",
        row("Previous balance", formatMoney(v.openingBalance)),
        row("This month", formatMoney(v.deliveryAmount)),
        row("Paid", formatMoney(v.paymentAmount)),
        RULE,
        row("Amount due", formatMoney(v.closingBalance)),
        "```",
        ...(v.upiLink ? ["", `Pay by UPI: ${v.upiLink}`] : []),
        ...(v.footerNote ? ["", v.footerNote] : []),
      ].join("\n"),
  },

  rate_change_v1: {
    label: "Rate change",
    category: "UTILITY",
    description: "Tells customers a product rate is changing, and from when.",
    schema: rateChangeVariables,
    render: (v: RateChangeVariables) =>
      [
        `*${v.businessName}*`,
        `Rate change from ${v.effectiveFrom}`,
        "",
        `Dear ${v.customerName},`,
        "",
        "```",
        ...v.changes.map((c) =>
          row(c.productName, `${formatMoney(c.oldRate)} -> ${formatMoney(c.newRate)}`, 20),
        ),
        "```",
        ...(v.note ? ["", v.note] : []),
      ].join("\n"),
  },

  payment_reminder_v1: {
    label: "Payment reminder",
    category: "UTILITY",
    description: "A reminder of the amount outstanding on a customer's account.",
    schema: paymentReminderVariables,
    render: (v: PaymentReminderVariables) =>
      [
        `*${v.businessName}*`,
        "",
        `${v.customerName} (${v.customerCode})`,
        "",
        `Amount outstanding as on ${v.asOf}: *${formatMoney(v.outstanding)}*`,
        ...(v.upiLink ? ["", `Pay by UPI: ${v.upiLink}`] : []),
      ].join("\n"),
  },

  notice_v1: {
    label: "General notice",
    category: "MARKETING",
    description:
      "Free-text announcement. Classified MARKETING because its content is unconstrained — WhatsApp judges by what is sent, not by what it is called.",
    schema: noticeVariables,
    render: (v: NoticeVariables) =>
      [`*${v.businessName}*`, `*${v.heading}*`, "", `Dear ${v.customerName},`, "", v.body].join("\n"),
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;

export function isTemplateKey(value: string): value is TemplateKey {
  return value in TEMPLATES;
}

// Single rendering entry point, used by both the preview in the web UI and the
// sender agent. Validating here rather than at the call sites means a row that
// was queued by an older version of the app — with variables that no longer fit
// its template — fails loudly at send time instead of producing a message with
// "undefined" in it.
export function renderTemplate(template: string, variables: unknown): string {
  if (!isTemplateKey(template)) {
    throw new Error(`Unknown notification template: ${template}`);
  }

  const definition = TEMPLATES[template];
  const parsed = definition.schema.safeParse(variables);

  if (!parsed.success) {
    throw new Error(`Invalid variables for template ${template}: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  return (definition.render as (v: unknown) => string)(parsed.data);
}

export function getTemplateCategory(template: string): TemplateCategory | null {
  return isTemplateKey(template) ? TEMPLATES[template].category : null;
}
