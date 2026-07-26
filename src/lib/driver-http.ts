import { NextResponse } from "next/server";

// The driver app is a separate-origin native/Expo client that authenticates
// with a Bearer token (never cookies), so a wildcard CORS origin is safe here —
// there are no ambient credentials for a hostile page to ride on.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function driverJson(body: unknown, status = 200, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...extraHeaders } });
}

export function driverPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
