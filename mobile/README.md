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
  run/[routeId].tsx     Interactive delivery run (stop-by-stop)
src/
  api.ts             fetch client (base URL + bearer token)
  session.tsx         SecureStore token/vehicle + context
  active-route.tsx     shared "is a route in progress" tracker (poll + refresh)
  route-progress.ts     route progress fetch/derive helpers
  location.ts          GPS capture, drift-confirm prompt, Apple/Google Maps navigation
  cash-sale.ts          LOCAL-ONLY cash sale storage (AsyncStorage, 2-day retention)
  theme.ts            pure palette DATA — color families (Teal/Ocean/Indigo) x light/dark
  theme-preference.tsx persisted appearance + theme choice, resolves to the active Palette
  ui.tsx              small component kit
  route-card.tsx
  components/SlideToConfirm.tsx   Reanimated slide-to-confirm
  components/Stepper.tsx          quantity stepper
  components/StopsListModal.tsx   search/jump-to-customer modal
  components/ActiveRoutePill.tsx  floating "route in progress" resume banner
  components/CashSaleModal.tsx    fast local cash-sale entry + 2-day history
```

## Status / next

Done: login, native tabs, Dashboard, Delivery, Profile, and the interactive
delivery run — single-stop card with pre-filled deliverables (carried forward
from the customer's most recent delivery) + quantity steppers, two
slide-to-confirm controls, auto-advance, undo, explicit Prev/Next and a
search/jump "All stops" modal, an explicit Finish-route action at the last
stop, a round-complete summary, a floating resume pill + one-active-route
guard app-wide, GPS (location captured on first delivery; a >12m drift on a
later delivery prompts before overwriting; Navigate opens Apple or Google
Maps on iOS, Google Maps directly on Android), Cash Sale (fast, **local-only**
entry, no server call ever, self-expires after 2 days), and a full theme
system in Profile — **Appearance** (System default / Light / Dark, persisted)
crossed with **Theme** (Teal / Ocean / Indigo color families, persisted),
resolved through one `useTheme()` every screen already reads from. Also has a
real app icon + splash screen (`assets/`, a milk-bottle mark on brand teal —
generated as SVG and rasterized locally, see git history if the source SVGs
are ever needed again).

Note: the splash screen's light/dark image follows the **device's** OS
appearance, not the in-app Appearance override above — the splash renders
before the JS/React tree (and thus before ThemePreferenceProvider) ever
starts, so it has no way to know about a persisted in-app choice. This is a
platform limitation, not a bug.

Next: offline queue for delivery marks, map/GPS beyond point-to-point
navigation (e.g. a live map view).
