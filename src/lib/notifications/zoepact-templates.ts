// The WhatsApp templates this app sends through Zoepact, written once here:
// their approved wording (what Meta reviews), and how our own variables fill the
// numbered {{1}}, {{2}} ... slots.
//
// The wording MUST match what is submitted to Meta exactly — an approved
// template can't be reworded, only replaced by a new version. Change a template
// by adding a new key (…_v2) and a new Zoepact name, never by editing in place.
//
// Pure: no I/O, so it is unit-tested like templates.ts.

import { z } from "zod";
import { formatMoney } from "@/lib/notifications/templates";

export type ZoepactTemplateDefinition = {
  label: string;
  description: string;
  // The name registered at Zoepact/Meta: lowercase letters, digits, underscore.
  zoepactName: string;
  category: "utility" | "marketing";
  language: string;
  body: string;
  footer: string;
  buttons?: Array<{ type: "url"; text: string; value: string; example: string }>;
  // How many {{n}} slots the body has; render() must produce exactly this many.
  slots: number;
};

const FOOTER = "BHRAMSHAKTI MILK PRODUCT";

export const ZOEPACT_TEMPLATES = {
  payment_reminder_hi_en_v1: {
    label: "Payment reminder",
    description: "Reminds a customer of the total outstanding, including a month's bill. Hindi and English in one message.",
    zoepactName: "bsmp_payment_reminder_v1",
    category: "utility",
    language: "hi",
    footer: FOOTER,
    slots: 4,
    body: [
      "नमस्कार जी 🙏",
      "आपके {{1}} माह के दूध बिल सहित कुल की राशि ₹ {{2}} का भुगतान अभी बाकी है।",
      "आपसे विनम्र अनुरोध है कि कृपया बकाया राशि का भुगतान जल्द से जल्द कर दें।",
      "यदि आपने भुगतान कर दिया है, तो कृपया इस संदेश को अनदेखा करें।",
      "धन्यवाद 🙏",
      "---",
      "Dear Customer,",
      "Your total outstanding payment, including the {{3}} milk bill, is ₹ {{4}}",
      "We kindly request you to clear the pending amount at the earliest.",
      "If you have already made the payment, please ignore this message.",
      "Thank you for your cooperation.",
    ].join("\n\n"),
  },

  monthly_bill_link_v1: {
    label: "Monthly bill (with View bill link)",
    description: "Tells a customer their month's bill is ready, with a button that opens the bill page.",
    zoepactName: "bsmp_monthly_bill_v1",
    category: "utility",
    language: "hi",
    footer: FOOTER,
    slots: 6,
    buttons: [
      {
        type: "url",
        text: "View bill",
        // {{1}} is the signed token; see src/lib/bill-link.ts.
        value: "https://atmv2.bsmp.in/b/{{1}}",
        example: "https://atmv2.bsmp.in/b/abc123",
      },
    ],
    body: [
      "नमस्कार {{1}} जी 🙏",
      "आपका {{2}} माह का दूध बिल तैयार है। कुल देय राशि: ₹ {{3}}",
      "---",
      "Dear {{4}}, your {{5}} milk bill is ready. Total amount due: ₹ {{6}}. Thank you.",
    ].join("\n\n"),
  },
} as const satisfies Record<string, ZoepactTemplateDefinition>;

export type ZoepactTemplateKey = keyof typeof ZOEPACT_TEMPLATES;

export function isZoepactTemplateKey(value: string): value is ZoepactTemplateKey {
  return value in ZOEPACT_TEMPLATES;
}

const HINDI_MONTHS = [
  "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
  "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
] as const;
const ENGLISH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// 1-12 -> the month in Hindi / English.
export function monthNames(month: number): { hi: string; en: string } {
  const index = Math.min(11, Math.max(0, Math.trunc(month) - 1));
  return { hi: HINDI_MONTHS[index], en: ENGLISH_MONTHS[index] };
}

export type PaymentReminderParams = { month: number; outstanding: number | string };
export type MonthlyBillLinkParams = { customerName: string; month: number; amountDue: number | string; token: string };

export function paymentReminderValues(params: PaymentReminderParams): string[] {
  const { hi, en } = monthNames(params.month);
  const amount = formatMoney(params.outstanding);
  return [hi, amount, en, amount];
}

export function monthlyBillLinkValues(params: MonthlyBillLinkParams): { variables: string[]; buttonToken: string } {
  const { hi, en } = monthNames(params.month);
  const amount = formatMoney(params.amountDue);
  // The name is repeated in the Hindi and English halves: Meta numbers every slot.
  return { variables: [params.customerName, hi, amount, params.customerName, en, amount], buttonToken: params.token };
}

// What the outbox stores for each key. Validated at send time, because the
// values come back out of a JSONB column and a row queued by an older version of
// the app must fail loudly, not send a customer a message with "undefined" in it.
const money = z.union([z.number(), z.string()]);

export const zoepactVariableSchemas = {
  payment_reminder_hi_en_v1: z.object({
    month: z.number().int().min(1).max(12),
    outstanding: money,
  }),
  monthly_bill_link_v1: z.object({
    customerName: z.string().min(1),
    month: z.number().int().min(1).max(12),
    amountDue: money,
    billId: z.string().uuid(),
  }),
} as const satisfies Record<ZoepactTemplateKey, z.ZodType>;

export const ZOEPACT_TEMPLATE_KEYS = Object.keys(ZOEPACT_TEMPLATES) as ZoepactTemplateKey[];
