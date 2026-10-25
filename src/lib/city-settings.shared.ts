// Per-city switches, declared once.
//
// Kept free of any server import so the Configuration screen can render the
// same declarations it saves against. Every setting has a default here, so
// adding one is a code change rather than a migration, and a city that has
// never opened the Configuration screen behaves exactly like one that has.

// Which layout a printed bill uses. Two real designs rather than a pile of
// toggles: a format is a whole set of decisions that have to agree with each
// other, and mixing them piecemeal produces a page that fits nothing.
export type BillFormat = "classic" | "compact";

// The message shared to WhatsApp for one vehicle's cycle. Plain text with
// {placeholder} substitution — see src/lib/reconciliation-share.ts for the
// exact placeholders. A whole-day share renders this once per vehicle and
// joins the results, rather than the template needing its own repeat syntax.
// *stars* are WhatsApp's own bold syntax, not markdown.
const DEFAULT_RECONCILIATION_SHARE_TEMPLATE = `*Reconciliation — {date}*
{vehicleCode} · {vehicleName}
{routes}

{products}

Cash sale {cashSale}
Received {received}
*Balance {balance}*`;

export type CitySettings = {
  // Occasional sales (a kilo of paneer, a one-off ghee order) are money on the
  // route summary without being a column of their own — on an office sheet a
  // column with seven values among sixty rows costs more than it tells. The
  // customer's own bill itemises them either way. Turn this on to get a column
  // per product actually sold.
  showOccasionalProductColumns: boolean;
  billFormat: BillFormat;
  // The route summary puts one column per product before the money columns
  // (Amount, Opening, Paid, Pending). A city selling many products pushes
  // those last four off-screen, so Pending — the figure the summary exists to
  // show — needs a horizontal scroll to even see. Capping to the first 3
  // products (by their own sort order) keeps the money columns on screen.
  limitSummaryProductColumns: boolean;
  // Free text, filled in per vehicle (or repeated per vehicle for a whole
  // day's share) and opened as a wa.me link. Editable per city so the wording
  // — and which figures appear at all — is the office's call, not a fixed
  // format baked into the screen.
  reconciliationShareTemplate: string;
};

export const CITY_SETTING_DEFAULTS: CitySettings = {
  showOccasionalProductColumns: false,
  // Classic is the default because it is what every customer has received so
  // far. Changing the look of a bill is the office's decision to make, not a
  // side effect of a deployment.
  billFormat: "classic",
  limitSummaryProductColumns: true,
  reconciliationShareTemplate: DEFAULT_RECONCILIATION_SHARE_TEMPLATE,
};

export type CitySettingKey = keyof CitySettings;

export const CITY_SETTING_KEYS = Object.keys(CITY_SETTING_DEFAULTS) as CitySettingKey[];

// How each setting reads to an operator, and what shape it takes on screen.
// Beside the defaults on purpose: a new setting cannot be added without
// deciding how it is explained.
// Settings are grouped by where the change shows up, so the screen stays
// readable as more arrive rather than becoming one long list.
export type SettingGroup = "Printing" | "Daily Entry" | "Reconciliation";

export const SETTING_GROUP_ORDER: SettingGroup[] = ["Printing", "Daily Entry", "Reconciliation"];

type SettingField =
  | { kind: "boolean"; group: SettingGroup; label: string; description: string }
  | {
      kind: "choice";
      group: SettingGroup;
      label: string;
      description: string;
      options: Array<{ value: string; label: string; description: string }>;
    }
  | {
      kind: "text";
      group: SettingGroup;
      label: string;
      description: string;
      multiline?: boolean;
      placeholders: Array<{ token: string; description: string }>;
    };

export const CITY_SETTING_FIELDS: Record<CitySettingKey, SettingField> = {
  billFormat: {
    kind: "choice",
    group: "Printing",
    label: "Bill format",
    // The thumbnails carry the explanation; the words only need to say what
    // the choice applies to.
    description: "Used for a single bill and for printing a whole route.",
    options: [
      { value: "classic", label: "Classic", description: "A row per day, amount beside each quantity." },
      { value: "compact", label: "One page", description: "Month in two halves, room for the payment details." },
    ],
  },
  showOccasionalProductColumns: {
    kind: "boolean",
    group: "Printing",
    label: "Column for occasional items on the route summary",
    description: "They are always in the totals, and always itemised on the bill.",
  },
  limitSummaryProductColumns: {
    kind: "boolean",
    group: "Printing",
    label: "Limit route summary to 3 products",
    description: "Keeps Amount, Opening and Pending on screen without scrolling. Turn off to show every product.",
  },
  reconciliationShareTemplate: {
    kind: "text",
    group: "Reconciliation",
    label: "WhatsApp share message",
    description: "Used by the share button on the Reconciliation screen, for one vehicle or the whole day.",
    multiline: true,
    placeholders: [
      { token: "{date}", description: "The cycle's close date" },
      { token: "{vehicleCode}", description: "Vehicle code" },
      { token: "{vehicleName}", description: "Vehicle name" },
      { token: "{routes}", description: "Evening and morning route names" },
      { token: "{products}", description: "One line per product — given, delivered, returned, leftover, value" },
      { token: "{cashSale}", description: "Total cash sale for the cycle" },
      { token: "{received}", description: "Payments already received" },
      { token: "{balance}", description: "What's still owed" },
    ],
  },
};

export function isCitySettingKey(value: string): value is CitySettingKey {
  return (CITY_SETTING_KEYS as string[]).includes(value);
}

// A stored value is text. Reading it back is defaults-first: anything that is
// not a value this setting declares falls back to the default rather than
// reaching a screen as nonsense.
export function parseCitySetting(key: CitySettingKey, raw: string): CitySettings[CitySettingKey] {
  const field = CITY_SETTING_FIELDS[key];

  if (field.kind === "boolean") {
    return raw === "true";
  }

  if (field.kind === "text") {
    return raw;
  }

  return field.options.some((option) => option.value === raw)
    ? (raw as BillFormat)
    : (CITY_SETTING_DEFAULTS[key] as BillFormat);
}

export function isValidCitySettingValue(key: CitySettingKey, raw: string): boolean {
  const field = CITY_SETTING_FIELDS[key];

  if (field.kind === "boolean") {
    return raw === "true" || raw === "false";
  }

  if (field.kind === "text") {
    return raw.trim().length > 0;
  }

  return field.options.some((option) => option.value === raw);
}
