import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-click start for the office PC.
//
// Runs OpenWA, waits for it to answer, makes sure the WhatsApp session is
// started, and opens the dashboard. From there the dashboard does the rest:
// show a QR if the number needs pairing, or nothing at all if it is already
// linked. This script deliberately does not try to handle the QR itself —
// the dashboard already does that well, and the only thing that was genuinely
// tedious was the typing.
//
// Written in Node because Node is already installed for OpenWA, it avoids
// Windows' PowerShell execution-policy prompts, and it has no dependencies to
// install or maintain.

const OPENWA_PATH = process.env.OPENWA_PATH ?? "C:\\openwa";
const API_URL = process.env.OPENWA_BASE_URL ?? "http://localhost:2785";
// Dev mode serves the dashboard from Vite on 2886; a production build
// (`npm run build:all` + `npm run start:prod`) serves it on 2785 instead.
const DASHBOARD_URL = process.env.OPENWA_DASHBOARD_URL ?? "http://localhost:2886";
const SESSION_NAME = process.env.OPENWA_SESSION_NAME ?? "bsmp";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (message) => console.log(message);

function stop(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function isUp() {
  try {
    const response = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function api(path, { method = "GET", key } = {}) {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error?.message ?? String(error) } };
  }
}

function open(target) {
  // The empty "" is the window title cmd's `start` expects; without it a quoted
  // target gets treated as the title and nothing opens.
  spawn("cmd.exe", ["/c", "start", '""', target], { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  say("\n  Starting WhatsApp gateway\n  =========================\n");

  if (await isUp()) {
    say("  OpenWA is already running.");
  } else {
    if (!existsSync(join(OPENWA_PATH, "package.json"))) {
      stop(`No OpenWA install at ${OPENWA_PATH}\n  Set OPENWA_PATH if it is somewhere else.`);
    }

    say(`  Launching OpenWA from ${OPENWA_PATH}...`);
    // Its own window, left open: if anything fails later, the reason is in there.
    spawn("cmd.exe", ["/c", "start", '"OpenWA"', "cmd", "/k", "npm run dev"], {
      cwd: OPENWA_PATH,
      detached: true,
      stdio: "ignore",
    }).unref();

    say("  Waiting for it to answer (this takes a minute or so)...");

    let ready = false;
    for (let waited = 0; waited < 180; waited += 3) {
      if (await isUp()) {
        ready = true;
        break;
      }
      if (waited > 0 && waited % 30 === 0) say(`  ...still starting (${waited}s)`);
      await sleep(3000);
    }

    if (!ready) {
      stop("OpenWA did not start within 3 minutes.\n  Check the OpenWA window — the error will be in there.");
    }
    say("  OpenWA is up.");
  }

  // Starting the session is the one step the dashboard will not do for you on a
  // fresh boot: AUTO_START_SESSIONS only resumes sessions that were previously
  // paired, so an unpaired one sits idle and shows no QR until it is started.
  const keyFile = join(OPENWA_PATH, "data", ".api-key");

  if (existsSync(keyFile)) {
    const key = readFileSync(keyFile, "utf8").trim();
    const list = await api("/api/sessions", { key });
    const sessions = Array.isArray(list.body) ? list.body : (list.body?.data ?? []);
    const session = sessions.find?.((entry) => entry.name === SESSION_NAME);

    // Exact match: OpenWA's statuses are created / initializing / qr_ready /
    // authenticating / ready / disconnected / failed, and only `ready` is
    // linked. A substring test wrongly matches "disconnected" and "qr_ready".
    const linked = String(session?.status ?? "").toLowerCase() === "ready";

    if (!session) {
      say(`  No session named "${SESSION_NAME}" yet — create one in the dashboard.`);
    } else if (linked) {
      say(`  Session "${SESSION_NAME}" is already linked — nothing to scan.`);
    } else {
      say(`  Starting session "${SESSION_NAME}" (status: ${session.status})...`);
      await api(`/api/sessions/${session.id}/start`, { method: "POST", key });
      say("  Started. The dashboard will show a QR shortly if it needs scanning.");
    }

    if (session?.id) {
      say(`\n  For agent\\.env:\n    OPENWA_SESSION_ID=${session.id}\n    OPENWA_API_KEY=${key}`);
    }
  }

  say(`\n  Opening ${DASHBOARD_URL}\n`);
  open(DASHBOARD_URL);

  say("  Leave the OpenWA window open — closing it stops WhatsApp.\n");
}

main().catch((error) => stop(error instanceof Error ? error.message : String(error)));
