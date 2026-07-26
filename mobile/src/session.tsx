import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthToken } from "@/api";
import type { DriverVehicle } from "@shared/driver-api-types";

const TOKEN_KEY = "bsmp.driver.token";
const VEHICLE_KEY = "bsmp.driver.vehicle";

type SessionValue = {
  loading: boolean;
  token: string | null;
  vehicle: DriverVehicle | null;
  signIn: (token: string, vehicle: DriverVehicle) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | undefined>(undefined);

// Persists the driver's token + vehicle in the device keychain (SecureStore) so
// they stay signed in across launches, and mirrors the token into the API client.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<DriverVehicle | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [storedToken, storedVehicle] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(VEHICLE_KEY),
        ]);
        if (!active) return;
        if (storedToken) {
          setToken(storedToken);
          setAuthToken(storedToken);
        }
        if (storedVehicle) {
          setVehicle(JSON.parse(storedVehicle) as DriverVehicle);
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
    setAuthToken(nextToken);
    setToken(nextToken);
    setVehicle(nextVehicle);
  };

  const signOut = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(VEHICLE_KEY);
    setAuthToken(null);
    setToken(null);
    setVehicle(null);
  };

  return (
    <SessionContext.Provider value={{ loading, token, vehicle, signIn, signOut }}>
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
