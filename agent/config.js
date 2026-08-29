import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Configuration for the office-PC sender agent.
//
// Read from a .env file beside this script rather than from the system
// environment: on Windows this runs as a service, and a service does not
// inherit the environment of whoever set it up. A file that sits next to the
// code is what someone can actually find and edit a year from now.

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  try {
    const contents = readFileSync(join(here, ".env"), "utf8");
    const values = {};

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const index = trimmed.indexOf("=");
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      values[key] = value;
    }

    return values;
  } catch {
    // No .env beside the script — fall back to the real environment, which is
    // how this runs during local testing.
    return {};
  }
}

const fileEnv = loadEnvFile();

function read(key, fallback) {
  return fileEnv[key] ?? process.env[key] ?? fallback;
}

function readNumber(key, fallback) {
  const raw = read(key);
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function required(key) {
  const value = read(key);
  if (!value) {
    throw new Error(`Missing ${key} in agent/.env — see agent/.env.example.`);
  }
  return value;
}

export function loadConfig() {
  const config = {
    // Where the queue lives.
    app: {
      baseUrl: required("APP_BASE_URL").replace(/\/$/, ""),
      secret: required("AGENT_SECRET"),
      timeoutMs: readNumber("APP_TIMEOUT_MS", 20_000),
    },

    // Where messages go out.
    openwa: {
      baseUrl: read("OPENWA_BASE_URL", "http://localhost:2785").replace(/\/$/, ""),
      apiKey: required("OPENWA_API_KEY"),
      sessionId: read("OPENWA_SESSION_ID", "bsmp"),
      timeoutMs: readNumber("OPENWA_TIMEOUT_MS", 30_000),
    },

    pacing: {
      // 20-30s by default: ~2000 messages across roughly a day and a half of
      // business hours, which is the shape agreed for this rollout.
      minSeconds: readNumber("MIN_GAP_SECONDS", 20),
      maxSeconds: readNumber("MAX_GAP_SECONDS", 30),
      startHour: readNumber("SEND_START_HOUR", 9),
      endHour: readNumber("SEND_END_HOUR", 21),
      // IST. Kept as an offset so the agent needs no timezone database.
      utcOffsetMinutes: readNumber("UTC_OFFSET_MINUTES", 330),
      dailyCap: readNumber("DAILY_CAP", 1200),
      // Start low and raise this deliberately as the number builds history.
      // Unset means no warm-up limit beyond the daily cap.
      warmupCap: readNumber("WARMUP_CAP", Number.POSITIVE_INFINITY),
      batchSize: readNumber("BATCH_SIZE", 25),
      breakerThreshold: readNumber("BREAKER_THRESHOLD", 8),
    },
  };

  if (config.pacing.minSeconds < 5) {
    throw new Error(
      "MIN_GAP_SECONDS below 5 is not safe — fast bulk sending is the main cause of WhatsApp bans.",
    );
  }

  return config;
}
