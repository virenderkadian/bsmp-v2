import type {
  DriverLoginResponse,
  DriverRoutesResponse,
  DriverSaveLineRequest,
  DriverSaveLineResponse,
  DriverSheetResponse,
} from "@shared/driver-api-types";

// Base URL of the web app that serves /api/driver/*. Point this at your machine's
// LAN address while developing (e.g. EXPO_PUBLIC_API_URL=http://192.168.1.5:3000),
// or the deployed dev/prod URL. A phone can't reach "localhost".
const BASE = (process.env.EXPO_PUBLIC_API_URL ?? "https://atmv2.bsmp.in").replace(/\/+$/, "");

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${response.status}).`;
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
};
