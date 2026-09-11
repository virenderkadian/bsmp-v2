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

export type CitySettings = {
  // Occasional sales (a kilo of paneer, a one-off ghee order) are money on the
  // route summary without being a column of their own — on an office sheet a
  // column with seven values among sixty rows costs more than it tells. The
  // customer's own bill itemises them either way. Turn this on to get a column
  // per product actually sold.
  showOccasionalProductColumns: boolean;
  billFormat: BillFormat;
};

export const CITY_SETTING_DEFAULTS: CitySettings = {
  showOccasionalProductColumns: false,
  // Classic is the default because it is what every customer has received so
  // far. Changing the look of a bill is the office's decision to make, not a
  // side effect of a deployment.
  billFormat: "classic",
};

export type CitySettingKey = keyof CitySettings;

export const CITY_SETTING_KEYS = Object.keys(CITY_SETTING_DEFAULTS) as CitySettingKey[];

// How each setting reads to an operator, and what shape it takes on screen.
// Beside the defaults on purpose: a new setting cannot be added without
// deciding how it is explained.
// Settings are grouped by where the change shows up, so the screen stays
// readable as more arrive rather than becoming one long list.
export type SettingGroup = "Printing" | "Daily Entry";

export const SETTING_GROUP_ORDER: SettingGroup[] = ["Printing", "Daily Entry"];

type SettingField =
  | { kind: "boolean"; group: SettingGroup; label: string; description: string }
  | {
      kind: "choice";
      group: SettingGroup;
      label: string;
      description: string;
      options: Array<{ value: string; label: string; description: string }>;
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

  return field.options.some((option) => option.value === raw)
    ? (raw as BillFormat)
    : (CITY_SETTING_DEFAULTS[key] as BillFormat);
}

export function isValidCitySettingValue(key: CitySettingKey, raw: string): boolean {
  const field = CITY_SETTING_FIELDS[key];

  return field.kind === "boolean"
    ? raw === "true" || raw === "false"
    : field.options.some((option) => option.value === raw);
}
