import type {
  DriverLoginResponse,
  DriverRoutesResponse,
  DriverSaveLineRequest,
  DriverSaveLineResponse,
  DriverSheetResponse,
  DriverPaymentRequest,
  DriverPaymentResponse,
  DriverUpdateCustomerRequest,
  DriverUpdateCustomerResponse,
} from "@shared/driver-api-types";

// Base URL of the web app that serves /api/driver/*. Point this at your machine's
// LAN address while developing (e.g. EXPO_PUBLIC_API_URL=http://192.168.1.5:3000),
// or the deployed dev/prod URL. A phone can't reach "localhost".
//
// EXPO_PUBLIC_* vars are inlined into the JS bundle at build time — if you add
// or change one in .env you MUST restart with `npx expo start -c` (a plain
// reload keeps the old baked-in value).
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "https://atmv2.bsmp.in").replace(/\/+$/, "");

// Vercel Deployment Protection guards Preview deployments from the open
// internet (they're not meant to be public — the driver login endpoint has no
// rate-limiting yet). This header is Vercel's documented bypass for trusted
// non-browser clients; it's the app's own secret, not the driver's, so it's
// sent unconditionally rather than tied to auth state. Unset on Production
// (which isn't protected) — see mobile/.env.example.
const PROTECTION_BYPASS = process.env.EXPO_PUBLIC_VERCEL_PROTECTION_BYPASS;

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// No timeout here previously meant a stuck connection (wrong URL, dead Wi-Fi,
// a TLS/DNS stall) spun the caller's loading state forever with no feedback.
// Every request now fails loudly after REQUEST_TIMEOUT_MS instead.
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(PROTECTION_BYPASS ? { "x-vercel-protection-bypass": PROTECTION_BYPASS } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // Wording a driver can act on. A full URL and the name of an env var
    // meant nothing to the person holding the phone mid-round, and these
    // messages surface in on-screen alerts. The diagnostic detail still goes
    // to console.warn below, and the login screen shows the resolved API_BASE.
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "The server took too long to respond. Check your connection and try again."
        : "No connection to the server. Your work is saved on this phone and will sync automatically.";
    console.warn("[driver-api] request failed", url, err);
    throw new ApiError(message, 0);
  } finally {
    clearTimeout(timeout);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${response.status}) at ${url}.`;
    console.warn("[driver-api] non-OK response", response.status, url, data);
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const api = {
  login: (vehicleCode: string, pin: string) =>
    request<DriverLoginResponse>("/api/driver/login", {
      method: "POST",
      body: JSON.stringify({ vehicleCode, pin }),
    }),
  routes: () => request<DriverRoutesResponse>("/api/driver/routes"),
  sheet: (routeId: string, date: string) =>
    request<DriverSheetResponse>(`/api/driver/routes/${routeId}/sheet?date=${encodeURIComponent(date)}`),
  saveLine: (routeId: string, customerId: string, body: DriverSaveLineRequest) =>
    request<DriverSaveLineResponse>(`/api/driver/routes/${routeId}/lines/${customerId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  recordPayment: (routeId: string, body: DriverPaymentRequest) =>
    request<DriverPaymentResponse>(`/api/driver/routes/${routeId}/payments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateCustomerMobile: (customerId: string, body: DriverUpdateCustomerRequest) =>
    request<DriverUpdateCustomerResponse>(`/api/driver/customers/${customerId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
