const encoder = new TextEncoder();

// The signing secret for the mobile app's tokens. One secret serves both token
// kinds — a vehicle's (driver-auth.ts) and an admin's (admin-app-auth.ts) — which
// are told apart by a claim and never accepted for one another.
export function getJwtSecret(): Uint8Array {
  const secret = process.env.DRIVER_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "DRIVER_JWT_SECRET is missing or too short (needs a 32+ character secret).",
    );
  }
  return encoder.encode(secret);
}
