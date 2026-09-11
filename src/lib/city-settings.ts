import "server-only";
import { prisma } from "@/lib/prisma";
import {
  CITY_SETTING_DEFAULTS,
  CITY_SETTING_KEYS,
  type CitySettingKey,
  type CitySettings,
} from "@/lib/city-settings.shared";

// Reading is defaults-first: a missing row, an unknown key, or an unparseable
// value all fall back to the declared default rather than failing. See
// city-settings.shared.ts for the declarations themselves.

function parse(value: string): boolean {
  return value === "true";
}

export async function getCitySettings(cityId: string): Promise<CitySettings> {
  try {
    const rows = await prisma.citySetting.findMany({
      where: { cityId },
      select: { key: true, value: true },
    });

    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const settings = { ...CITY_SETTING_DEFAULTS };

    for (const key of CITY_SETTING_KEYS) {
      const value = stored.get(key);
      if (value !== undefined) {
        settings[key] = parse(value);
      }
    }

    return settings;
  } catch {
    // A settings table that cannot be read must not take down the screen it
    // was configuring. Defaults are always a valid configuration.
    return { ...CITY_SETTING_DEFAULTS };
  }
}

export async function setCitySetting(cityId: string, key: CitySettingKey, value: boolean) {
  await prisma.citySetting.upsert({
    where: { cityId_key: { cityId, key } },
    update: { value: String(value) },
    create: { cityId, key, value: String(value) },
  });
}
