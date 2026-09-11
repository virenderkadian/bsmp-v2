// Per-city switches, declared once.
//
// Kept free of any server import so the Configuration screen can render the
// same declarations it saves against. Every setting has a default here, so
// adding one is a code change rather than a migration, and a city that has
// never opened the Configuration screen behaves exactly like one that has.

export type CitySettings = {
  // Occasional sales (a kilo of paneer, a one-off ghee order) are money on the
  // route summary without being a column of their own — on an office sheet a
  // column with seven values among sixty rows costs more than it tells. The
  // customer's own bill itemises them beneath the calendar either way. Turn
  // this on to get a column per product actually sold.
  showOccasionalProductColumns: boolean;
};

export const CITY_SETTING_DEFAULTS: CitySettings = {
  showOccasionalProductColumns: false,
};

export type CitySettingKey = keyof CitySettings;

export const CITY_SETTING_KEYS = Object.keys(CITY_SETTING_DEFAULTS) as CitySettingKey[];

// What the Configuration screen renders. Beside the defaults on purpose: a new
// setting cannot be added without deciding how it reads to an operator.
export const CITY_SETTING_LABELS: Record<CitySettingKey, { label: string; description: string }> = {
  showOccasionalProductColumns: {
    label: "Show a column for occasional items on the route summary",
    description:
      "Off by default. Occasional sales are always counted in the amounts and always itemised on the customer's bill — this only decides whether they also get a column of their own on the internal summary sheet.",
  },
};

export function isCitySettingKey(value: string): value is CitySettingKey {
  return (CITY_SETTING_KEYS as string[]).includes(value);
}
