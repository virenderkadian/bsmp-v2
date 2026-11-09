import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setActingVehicle, setAuthToken } from "@/api";
import type { AdminUser, DriverVehicle } from "@shared/driver-api-types";

const TOKEN_KEY = "bsmp.driver.token";
const VEHICLE_KEY = "bsmp.driver.vehicle";
const ADMIN_KEY = "bsmp.driver.admin";

type SessionValue = {
  loading: boolean;
  token: string | null;
  // The vehicle on screen. A driver's own; for an admin, the one they picked.
  vehicle: DriverVehicle | null;
  // Set only when an admin is signed in. Drivers never have it.
  admin: AdminUser | null;
  signIn: (token: string, vehicle: DriverVehicle) => Promise<void>;
  signInAdmin: (token: string, admin: AdminUser) => Promise<void>;
  // Admin only: act on a different vehicle.
  selectVehicle: (vehicle: DriverVehicle | null) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | undefined>(undefined);

// Persists the signed-in identity in the device keychain (SecureStore) so it
// survives launches, and mirrors the token — and for an admin the chosen
// vehicle — into the API client.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<DriverVehicle | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [storedToken, storedVehicle, storedAdmin] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(VEHICLE_KEY),
          SecureStore.getItemAsync(ADMIN_KEY),
        ]);
        if (!active) return;
        if (storedToken) {
          setToken(storedToken);
          setAuthToken(storedToken);
        }
        if (storedAdmin) {
          setAdmin(JSON.parse(storedAdmin) as AdminUser);
        }
        if (storedVehicle) {
          const parsed = JSON.parse(storedVehicle) as DriverVehicle;
          setVehicle(parsed);
          // Only an admin session names a vehicle per request.
          if (storedAdmin) setActingVehicle(parsed.id);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const signIn = async (nextToken: string, nextVehicle: DriverVehicle) => {
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    await SecureStore.setItemAsync(VEHICLE_KEY, JSON.stringify(nextVehicle));
    await SecureStore.deleteItemAsync(ADMIN_KEY);
    setAuthToken(nextToken);
    setActingVehicle(null);
    setToken(nextToken);
    setVehicle(nextVehicle);
    setAdmin(null);
  };

  const signInAdmin = async (nextToken: string, nextAdmin: AdminUser) => {
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    await SecureStore.setItemAsync(ADMIN_KEY, JSON.stringify(nextAdmin));
    // No vehicle yet: the admin picks one next.
    await SecureStore.deleteItemAsync(VEHICLE_KEY);
    setAuthToken(nextToken);
    setActingVehicle(null);
    setToken(nextToken);
    setAdmin(nextAdmin);
    setVehicle(null);
  };

  const selectVehicle = async (next: DriverVehicle | null) => {
    if (next) {
      await SecureStore.setItemAsync(VEHICLE_KEY, JSON.stringify(next));
    } else {
      await SecureStore.deleteItemAsync(VEHICLE_KEY);
    }
    setActingVehicle(next ? next.id : null);
    setVehicle(next);
  };

  const signOut = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(VEHICLE_KEY);
    await SecureStore.deleteItemAsync(ADMIN_KEY);
    setAuthToken(null);
    setActingVehicle(null);
    setToken(null);
    setVehicle(null);
    setAdmin(null);
  };

  return (
    <SessionContext.Provider value={{ loading, token, vehicle, admin, signIn, signInAdmin, selectVehicle, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}
