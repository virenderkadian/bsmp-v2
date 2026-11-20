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

// Longest a notice's variable text may be. The whole message must stay under
// WhatsApp's 1,024-character body limit once the fixed wording is added.
export const MAX_NOTICE_TEXT = 400;

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

  rate_change_notice_v1: {
    label: "Rate change notice",
    description: "Tells customers the rates of one or more products are changing, and from when. Hindi and English in one message.",
    zoepactName: "bsmp_rate_change_v1",
    category: "utility",
    language: "hi",
    footer: FOOTER,
    slots: 4,
    body: [
      "नमस्कार जी 🙏",
      "{{1}} से हमारे उत्पादों के दामों में बदलाव किया जा रहा है:",
      "{{2}}",
      "आपके सहयोग के लिए धन्यवाद 🙏",
      "---",
      "Dear Customer,",
      "From {{3}}, our rates will change as follows:",
      "{{4}}",
      "Thank you for your continued support.",
    ].join("\n\n"),
  },

  delivery_notice_v1: {
    label: "Delivery timing or holiday notice",
    description: "Tells customers about a change to milk delivery on a given day, such as a holiday or a late round. Hindi and English in one message.",
    zoepactName: "bsmp_delivery_notice_v1",
    category: "utility",
    language: "hi",
    footer: FOOTER,
    slots: 4,
    body: [
      "नमस्कार जी 🙏",
      "{{1}} को दूध की डिलीवरी के बारे में सूचना: {{2}}",
      "असुविधा के लिए हमें खेद है 🙏",
      "---",
      "Dear Customer,",
      "Notice about milk delivery on {{3}}: {{4}}",
      "We apologise for any inconvenience.",
    ].join("\n\n"),
  },

  delivery_completed_v1: {
    label: "Delivery completed",
    description: "Tells a customer their milk delivery for a day is completed, with what was delivered, the price of each item and the day's total. Hindi and English in one message.",
    zoepactName: "bsmp_delivery_completed_v1",
    category: "utility",
    language: "hi",
    footer: FOOTER,
    slots: 6,
    body: [
      "नमस्कार जी 🙏",
      "{{1}} की आपकी दूध की डिलीवरी पूरी हो गई है:",
      "{{2}}",
      "कुल राशि: ₹ {{3}}",
      "धन्यवाद 🙏",
      "---",
      "Dear Customer,",
      "Your milk delivery on {{4}} is completed:",
      "{{5}}",
      "Total amount: ₹ {{6}}",
      "Thank you for your support.",
    ].join("\n\n"),
  },

  payment_received_v1: {
    label: "Payment received",
    description: "Confirms to a customer that a payment was received, with the amount, the date and how it was paid. Hindi and English in one message.",
    zoepactName: "bsmp_payment_received_v1",
    category: "utility",
    language: "hi",
    footer: FOOTER,
    slots: 6,
    body: [
      "नमस्कार जी 🙏",
      "आपका ₹ {{1}} का भुगतान ({{3}}) {{2}} को प्राप्त हो गया है।",
      "धन्यवाद 🙏",
      "---",
      "Dear Customer,",
      "We have received your payment of ₹ {{4}} ({{6}}) on {{5}}.",
      "Thank you for your payment.",
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
  rate_change_notice_v1: z.object({
    effectiveDate: z.string().trim().min(1).max(40).refine(isSingleLine, "Must be a single line"),
    // The same products twice: names and units in Hindi for the Hindi half of the
    // message, in English for the English half.
    ratesTextHi: z.string().trim().min(1).max(MAX_NOTICE_TEXT).refine(isSingleLine, "Must be a single line"),
    ratesTextEn: z.string().trim().min(1).max(MAX_NOTICE_TEXT).refine(isSingleLine, "Must be a single line"),
  }),
  payment_received_v1: z.object({
    amount: money,
    date: z.string().trim().min(1).max(40).refine(isSingleLine, "Must be a single line"),
    // CASH, UPI, BANK_TRANSFER or CHEQUE, as stored; shown to the customer in words.
    mode: z.string().trim().min(1).max(30).refine(isSingleLine, "Must be a single line"),
    // Which payment this confirms, so the sender can stop it if the payment is cancelled before it is sent.
    paymentId: z.string().uuid().optional(),
  }),
  delivery_completed_v1: z.object({
    date: z.string().trim().min(1).max(40).refine(isSingleLine, "Must be a single line"),
    itemsText: z.string().trim().min(1).max(MAX_NOTICE_TEXT).refine(isSingleLine, "Must be a single line"),
    amount: money,
  }),
  delivery_notice_v1: z.object({
    date: z.string().trim().min(1).max(40).refine(isSingleLine, "Must be a single line"),
    messageHi: z.string().trim().min(1).max(MAX_NOTICE_TEXT).refine(isSingleLine, "Must be a single line"),
    messageEn: z.string().trim().min(1).max(MAX_NOTICE_TEXT).refine(isSingleLine, "Must be a single line"),
  }),
} as const satisfies Record<ZoepactTemplateKey, z.ZodType>;

export const ZOEPACT_TEMPLATE_KEYS = Object.keys(ZOEPACT_TEMPLATES) as ZoepactTemplateKey[];

// ---- Notices: rate changes and delivery notices ----

// A WhatsApp template value must be ONE line: Meta rejects line breaks, tabs and
// long runs of spaces inside a variable. That is why several products travel as one
// line joined with "; " rather than one line each — which also lets a single approved
// template carry any number of products.
export function isSingleLine(value: string): boolean {
  return !/[\n\r\t]/.test(value) && !/ {5,}/.test(value);
}

// Collapses pasted text (line breaks, tabs, runs of spaces) into one tidy line.
export function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type RateChangeItem = {
  name: string;
  // The Hindi name for the Hindi half; falls back to `name` when left empty.
  nameHi?: string;
  unit?: string;
  // The Hindi unit; falls back to a translation of `unit` for the common ones.
  unitHi?: string;
  oldRate: number | string;
  newRate: number | string;
};

// 60 -> "₹60", 62.5 -> "₹62.50": whole rupees stay plain, the rest keep paise.
export function formatRupees(value: number | string): string {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "₹0";
  return Number.isInteger(amount) ? `₹${amount}` : `₹${amount.toFixed(2)}`;
}

const HINDI_UNITS: Record<string, string> = {
  litre: "लीटर", liter: "लीटर", ltr: "लीटर", l: "लीटर",
  kg: "किलो", kilo: "किलो", kilogram: "किलो",
  gm: "ग्राम", gram: "ग्राम", g: "ग्राम",
  piece: "पीस", pieces: "पीस", pc: "पीस", pcs: "पीस", nos: "पीस",
  packet: "पैकेट", pack: "पैकेट", dozen: "दर्जन",
};

// "litre" -> "लीटर"; anything not in the list is returned as typed.
export function hindiUnit(unit: string): string {
  const clean = toSingleLine(unit);
  return HINDI_UNITS[clean.toLowerCase()] ?? clean;
}

// English: "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340"
export function buildRatesText(items: RateChangeItem[]): string {
  return items
    .map((item) => `${toSingleLine(item.name)}${item.unit ? ` (per ${toSingleLine(item.unit)})` : ""}: ${formatRupees(item.oldRate)} → ${formatRupees(item.newRate)}`)
    .join("; ");
}

// Hindi: "दूध (प्रति लीटर): ₹60 → ₹62; पनीर (प्रति किलो): ₹320 → ₹340"
export function buildRatesTextHindi(items: RateChangeItem[]): string {
  return items
    .map((item) => {
      const name = toSingleLine(item.nameHi ?? "") || toSingleLine(item.name);
      const unit = toSingleLine(item.unitHi ?? "") || (item.unit ? hindiUnit(item.unit) : "");
      return `${name}${unit ? ` (प्रति ${unit})` : ""}: ${formatRupees(item.oldRate)} → ${formatRupees(item.newRate)}`;
    })
    .join("; ");
}

export type RateChangeParams = { effectiveDate: string; ratesTextHi: string; ratesTextEn: string };
export type DeliveryNoticeParams = { date: string; messageHi: string; messageEn: string };

// The date appears in both languages; the product list is the Hindi one first, then the English one.
export function rateChangeValues(params: RateChangeParams): string[] {
  return [params.effectiveDate, params.ratesTextHi, params.effectiveDate, params.ratesTextEn];
}

export function deliveryNoticeValues(params: DeliveryNoticeParams): string[] {
  return [params.date, params.messageHi, params.date, params.messageEn];
}

// ---- Editing a template's wording ----

// What each numbered blank means, so the editor can show it. The ORDER and MEANING of
// the blanks is fixed by the code that fills them (the value builders above): a
// reworded message may move them around, but must keep every one.
export const SLOT_HELP: Record<ZoepactTemplateKey, string[]> = {
  payment_reminder_hi_en_v1: ["Month, in Hindi", "Amount outstanding", "Month, in English", "Amount outstanding"],
  monthly_bill_link_v1: ["Customer name", "Month, in Hindi", "Amount due", "Customer name", "Month, in English", "Amount due"],
  rate_change_notice_v1: ["Date the new rates apply from", "Products and rates, in Hindi", "Date the new rates apply from", "Products and rates, in English"],
  delivery_notice_v1: ["Date", "Message, in Hindi", "Date", "Message, in English"],
  payment_received_v1: ["Amount received", "Date received", "How it was paid, in Hindi", "Amount received", "Date received", "How it was paid, in English"],
  delivery_completed_v1: ["Delivery date", "Products delivered, with the price of each", "Total amount for the day", "Delivery date", "Products delivered, with the price of each", "Total amount for the day"],
};

// Whether the template has a button whose label can be edited (its link is fixed).
export function buttonLabelOf(key: ZoepactTemplateKey): string | null {
  const definition: ZoepactTemplateDefinition = ZOEPACT_TEMPLATES[key];
  return definition.buttons?.[0]?.text ?? null;
}

export type WordingInput = { body: string; footer: string; buttonText?: string };

// Meta's own rules plus ours, as plain messages for the person editing. Empty means
// the wording can be submitted. Everything here is something Meta would reject, or
// that would send a customer a message with a blank in it.
export function validateWording(key: ZoepactTemplateKey, input: WordingInput): string[] {
  const errors: string[] = [];
  const definition: ZoepactTemplateDefinition = ZOEPACT_TEMPLATES[key];
  const body = input.body.trim();

  if (!body) {
    errors.push("The message can't be empty.");
    return errors;
  }
  if (body.length > 1024) errors.push(`The message is ${body.length} characters; WhatsApp allows 1,024.`);

  // Only numbered blanks, written exactly {{1}}.
  const stray = body.replace(/\{\{\d+\}\}/g, "");
  if (stray.includes("{{") || stray.includes("}}")) {
    errors.push("Blanks must be written like {{1}}, {{2}}. Remove any other { } brackets.");
  }

  const found = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  const missing: number[] = [];
  for (let slot = 1; slot <= definition.slots; slot += 1) {
    const count = found.filter((number) => number === slot).length;
    if (count === 0) missing.push(slot);
    if (count > 1) errors.push(`{{${slot}}} is used ${count} times. Use each blank once.`);
  }
  if (missing.length > 0) errors.push(`Missing ${missing.map((slot) => `{{${slot}}}`).join(", ")}. Every blank must stay in the message.`);
  const extra = [...new Set(found.filter((number) => number < 1 || number > definition.slots))];
  if (extra.length > 0) errors.push(`${extra.map((slot) => `{{${slot}}}`).join(", ")} doesn't exist. This message has blanks {{1}} to {{${definition.slots}}}.`);

  // Meta rejects a message that opens or closes with a blank, or two blanks touching.
  if (/^\{\{\d+\}\}/.test(body)) errors.push("The message can't start with a blank. Put some words first.");
  if (/\{\{\d+\}\}$/.test(body)) errors.push("The message can't end with a blank. Put some words after it.");
  if (/\}\}\{\{/.test(body)) {
    errors.push("Two blanks can't touch. Put a word or space between them.");
  }

  const footer = input.footer.trim();
  if (footer.length > 60) errors.push(`The footer is ${footer.length} characters; the limit is 60.`);
  if (/[\n\r]/.test(footer)) errors.push("The footer must be one line.");
  if (/\{\{|\}\}/.test(footer)) errors.push("The footer can't contain blanks.");

  const expectsButton = buttonLabelOf(key) !== null;
  const buttonText = (input.buttonText ?? "").trim();
  if (expectsButton) {
    if (!buttonText) errors.push("The button needs a label.");
    if (buttonText.length > 25) errors.push(`The button label is ${buttonText.length} characters; the limit is 25.`);
    if (/[\n\r]/.test(buttonText)) errors.push("The button label must be one line.");
  }

  return errors;
}

// "bsmp_payment_reminder_v1" + version 2 -> "bsmp_payment_reminder_v2".
export function versionName(key: ZoepactTemplateKey, version: number): string {
  const base = ZOEPACT_TEMPLATES[key].zoepactName.replace(/_v\d+$/, "");
  return `${base}_v${version}`;
}

// ---- Delivery completed ----

export type DeliveredItem = { name: string; quantity: number; unit: string; amount: number };

// "Buffalo milk 1 litre = ₹90; Paneer 0.5 kg = ₹170": what was delivered and what each
// line came to, on ONE line (a template value can't contain a line break).
export function buildDeliveredItemsText(items: DeliveredItem[]): string {
  return items
    .map((item) => {
      const quantity = item.quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 });
      return `${toSingleLine(item.name)} ${quantity}${item.unit ? ` ${toSingleLine(item.unit)}` : ""} = ${formatRupees(item.amount)}`;
    })
    .join("; ");
}

export type DeliveryCompletedParams = { date: string; itemsText: string; amount: number | string };

// The date, the products and the total each appear in both languages.
export function deliveryCompletedValues(params: DeliveryCompletedParams): string[] {
  const total = formatMoney(params.amount);
  return [params.date, params.itemsText, total, params.date, params.itemsText, total];
}

// ---- Payment received ----

const PAYMENT_MODE_WORDS: Record<string, { hi: string; en: string }> = {
  CASH: { hi: "नकद", en: "cash" },
  UPI: { hi: "UPI", en: "UPI" },
  BANK_TRANSFER: { hi: "बैंक ट्रांसफर", en: "bank transfer" },
  CHEQUE: { hi: "चेक", en: "cheque" },
};

// How a payment was made, in words, in each language. An unknown mode is shown as stored.
export function paymentModeWords(mode: string): { hi: string; en: string } {
  const clean = toSingleLine(mode);
  return PAYMENT_MODE_WORDS[clean.toUpperCase()] ?? { hi: clean, en: clean };
}

export type PaymentReceivedParams = { amount: number | string; date: string; mode: string };

// Amount, date and mode each appear in both languages: the Hindi blanks first, then English.
export function paymentReceivedValues(params: PaymentReceivedParams): string[] {
  const amount = formatMoney(params.amount);
  const words = paymentModeWords(params.mode);
  return [amount, params.date, words.hi, amount, params.date, words.en];
}
