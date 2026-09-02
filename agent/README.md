# WhatsApp sender agent

Sends queued customer messages from the office PC. Runs beside OpenWA (the
WhatsApp gateway) and talks to the web app over HTTPS.

## Why this exists

The web app runs on Vercel and cannot reach a PC in your office. So it never
sends anything — it writes rows to a queue in the database, and this agent
drains them from a machine that *can* hold a WhatsApp connection.

Everything durable lives in the database. This agent keeps no state of its own,
so switching the PC off mid-run loses nothing: unsent rows stay queued, claimed
rows return to the queue when their lease expires, and the next start resumes
where it stopped.

```
Web app (Vercel) ──writes──▶ queue (Postgres) ◀──claims── agent ──▶ OpenWA ──▶ WhatsApp
```

## Requirements

- **Node.js 20 or newer** ([nodejs.org](https://nodejs.org) — the LTS installer)
- **OpenWA** running on the same machine
- The machine on and online during sending hours

No npm install. The agent deliberately has zero dependencies so there is nothing
to break a year from now.

## 1. Install OpenWA

Clone it somewhere sensible (e.g. `C:\openwa`), then:

```
copy .env.minimal .env
npm install
npm run dev
```

Then edit `.env` and change two things:

| Setting | Value | Why |
|---|---|---|
| `ENGINE_TYPE` | `baileys` | The default (`whatsapp-web.js`) runs a full hidden Chrome and needs ~1 GB. Baileys is a plain WebSocket at ~200 MB — which matters on a PC that also runs Tally. |
| `AUTO_START_SESSIONS` | `true` | Defaults to `false`, which leaves the session dead after every restart until someone starts it by hand. |

Leave it bound to `localhost`. Nothing here should be reachable from the
internet — the machine holds your accounting data.

## 2. Pair the WhatsApp number

Open the dashboard and create a session — the payload is `{"name": "bsmp"}`;
the name is 3-50 characters, letters/numbers/hyphens only, and there is no `id`
field (the server assigns one). Start it, then scan the QR with the phone
holding the number.

**Note the session's `id` from the response.** OpenWA looks sessions up by id
only, never by name, so the id — not `bsmp` — is what goes in `.env` as
`OPENWA_SESSION_ID`.

If the dashboard errors while creating a session, the API works directly:

```
curl -X POST http://localhost:2785/api/sessions -H "X-API-Key: KEY" ^
  -H "Content-Type: application/json" -d "{\"name\":\"bsmp\"}"
curl -X POST http://localhost:2785/api/sessions/<id>/start -H "X-API-Key: KEY"
curl http://localhost:2785/api/sessions/<id>/qr -H "X-API-Key: KEY"
```

Use a **spare number**, not your main business line. If WhatsApp ever restricts
it, you do not want that to be the number printed on your bills.

Create an API key with the **OPERATOR** role and keep it for the next step.

## 3. Configure the agent

Copy `.env.example` to `.env` in this folder and fill it in.

Generate the shared secret with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The same value must be set as `NOTIFICATIONS_AGENT_SECRET` in the web app's
environment (Vercel → Settings → Environment Variables), along with
`NOTIFICATIONS_ENABLED=true`. Until both are set, the feature stays dormant and
the WhatsApp screen does not appear.

## 4. Run it

```
node index.js
```

You should see the session confirmed, then either `queue empty — waiting` or
messages going out one at a time.

## Everyday use: the two buttons

`agent\windows\` holds two double-clickable files. They are deliberately
separate — see the note below.

**`START WHATSAPP.bat`** — brings the connection up. Starts OpenWA, waits for
it, starts the WhatsApp session, opens the dashboard. Safe to run any time: it
sends nothing. Use it to pair a number, rescan an expired QR, or just check the
session is healthy.

**`START SENDING.bat`** — starts the agent, which drains the queue and sends
real messages to real customers. Requires the first one to be running already.

They are two buttons rather than one on purpose: bringing WhatsApp up is
harmless and routine, while sending is neither. Bundling them would mean that
checking the connection also starts messaging customers.

Both keep their window open. Closing the sending window stops sending; nothing
is lost, because unsent messages stay queued and resume next time.

## 5. Run it as a Windows service

Running it in a window means someone eventually closes it, and it will not come
back after a restart. As a service it starts with Windows and runs invisibly.

Using [NSSM](https://nssm.cc):

```
nssm install BSMPWhatsAppAgent "C:\Program Files\nodejs\node.exe" "C:\bsmp\agent\index.js"
nssm set BSMPWhatsAppAgent AppDirectory C:\bsmp\agent
nssm set BSMPWhatsAppAgent AppStdout C:\bsmp\agent\agent.log
nssm set BSMPWhatsAppAgent AppStderr C:\bsmp\agent\agent.log
nssm start BSMPWhatsAppAgent
```

Do the same for OpenWA so both survive a reboot.

## Pacing — read this before changing it

The defaults send roughly 2000 messages across a day and a half. That slowness
is the point.

| Setting | Default | Why |
|---|---|---|
| `MIN_GAP_SECONDS` / `MAX_GAP_SECONDS` | 20 / 30 | Randomised, because a message every *exactly* 20 seconds is a signature no human produces. Fast bulk sending is the main cause of WhatsApp bans. |
| `SEND_START_HOUR` / `SEND_END_HOUR` | 9 / 21 | Messages at 3am annoy people into blocking, and a block is a stronger ban signal than volume. |
| `DAILY_CAP` | 1200 | Counted by the server, so restarting the PC cannot reset it. |
| `WARMUP_CAP` | 200 | A new number sending 2000 messages in its first week looks like a spammer however slowly it does it. Raise this every few weeks; remove it once the number has months of history. |
| `BREAKER_THRESHOLD` | 8 | Consecutive failures are the earliest sign of a restricted number. Continuing at that point turns a warning into a ban. |

The agent refuses to start with `MIN_GAP_SECONDS` below 5.

## What it does on failure

| Situation | Behaviour |
|---|---|
| PC switched off mid-run | Claimed rows return to the queue after ~5 minutes; the rest were never touched |
| Cannot reach the web app | Waits 60s and retries. Does **not** count toward the circuit breaker — that is a network problem, not a WhatsApp one |
| One bad number | That row fails alone with a reason; the other 1,999 continue |
| 8 failures in a row | Stops completely and says so. Check WhatsApp on the paired phone before restarting |
| Session not connected at startup | Refuses to start, rather than failing every send and looking like a ban |

## Watching a run

Progress is on the **WhatsApp → Outbox** tab in the web app: per-batch progress,
failures with reasons, and a button to stop the remainder. You do not need to
watch the agent's console.

## Swapping providers later

`openwa.js` is the only file that knows OpenWA exists. Moving to Meta's official
Cloud API means writing a second file with the same two exports and pointing
`config.js` at it. The queue, the pacing, the templates, and the web UI are all
unaffected.
