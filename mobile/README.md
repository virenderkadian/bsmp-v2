# BSMP Driver Mobile App

Expo / React Native app for drivers: log in as a vehicle (code + PIN), see the
vehicle's routes, and mark each customer on the monthly sequence delivered or
skipped with quantities. Talks to the web app's `/api/driver/*` JSON API.

## Why it lives here but stays isolated

This folder is in the same git repo as the web app (one place to manage, shared
API types), but it is **deliberately not part of the web app's npm setup**:

- The repo root has **no `workspaces` field**, so `npm install` at the root
  never touches this folder. Install deps from **inside `mobile/`** only.
- It keeps its **own `node_modules`** so Expo/React Native can pin its own React
  version without colliding with Next.js (React 19).
- The repo's **`.vercelignore`** excludes `mobile/`, so Vercel web builds never
  see it.
- Built and shipped with **Expo EAS**, not Vercel.

## Shared API types

The request/response contract lives once, in the web app, at
`src/lib/driver-api-types.ts`. This app imports it as `@shared/driver-api-types`
(see `tsconfig.json` paths). Because those imports are **type-only**, Babel
strips them and Metro never resolves anything outside this project at runtime.

## Run it

```bash
cd mobile
npm install
npx expo install        # aligns native package versions to your Expo SDK
cp .env.example .env     # then set EXPO_PUBLIC_API_URL to your web app's URL
npx expo start
```

- Point `EXPO_PUBLIC_API_URL` at your machine's **LAN IP** (e.g.
  `http://192.168.1.5:3000`) while the web app runs locally — a phone can't
  reach `localhost` — or at the deployed dev URL.
- The web app must have the vehicle-PIN migration applied and a vehicle with a
  PIN set (Routes screen → edit a vehicle → Driver login PIN). A dev test
  vehicle already exists: **code `DRV-TEST`, PIN `4821`**.
- Open in Expo Go or a dev build on a phone/simulator.

## Structure

```
app/
  _layout.tsx           providers + auth-gated stack
  login.tsx             vehicle code + PIN
  (tabs)/_layout.tsx    NATIVE bottom tabs (liquid glass iOS / Material Android)
  (tabs)/index.tsx      Dashboard
  (tabs)/delivery.tsx   Routes to run
  (tabs)/profile.tsx    Vehicle info, links, log out
  run/[routeId].tsx     Delivery run (currently a live read-only stop list)
src/
  api.ts        fetch client (base URL + bearer token)
  session.tsx   SecureStore token/vehicle + context
  theme.ts      palette (light/dark)
  ui.tsx        small component kit
  route-card.tsx
```

## Status / next

Done: login, native tabs, Dashboard, Delivery, Profile, and a live delivery run
that lists the real monthly-sequence stops with pre-filled deliverables.

Next: the interactive stop-by-stop flow — the two slide-to-confirm controls
(slide right = deliver, left = skip), auto-advance, undo — plus the stops search
and the round-complete summary. Later: offline queue, cash sale, map/GPS.
