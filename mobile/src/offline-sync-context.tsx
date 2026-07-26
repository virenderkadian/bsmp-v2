import NetInfo from "@react-native-community/netinfo";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, AppState } from "react-native";
import { getAllQueued } from "@/offline-queue";
import { flushOfflineQueue, type SyncResult } from "@/sync";

type OfflineSyncValue = {
  pendingCount: number;
  isOnline: boolean;
  syncing: boolean;
  syncNow: () => Promise<SyncResult | null>;
  refreshPendingCount: () => void;
};

const OfflineSyncContext = createContext<OfflineSyncValue>({
  pendingCount: 0,
  isOnline: true,
  syncing: false,
  syncNow: async () => null,
  refreshPendingCount: () => undefined,
});

// App-wide: tracks how many delivery marks are queued locally (not yet
// confirmed by the server) and auto-flushes on reconnect / app foreground,
// with a slow fallback poll in case a platform ever misses those events.
// Screens read pendingCount/isOnline for their own indicators and call
// syncNow() for a manual "sync now" action; the actual replay logic lives in
// src/sync.ts, this just decides WHEN to call it.
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(() => {
    getAllQueued().then((items) => setPendingCount(items.length));
  }, []);

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    if (syncingRef.current) {
      return null;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await flushOfflineQueue();
      refreshPendingCount();
      if (result.failed.length > 0) {
        // Surfaced here (app-wide) rather than only on the run screen — a
        // permanent rejection (bill locked, etc.) can be discovered by a
        // background sync while the driver is on any screen, and needs their
        // attention regardless of what they're looking at.
        Alert.alert(
          "Some deliveries couldn't sync",
          result.failed.map((failure) => `• ${failure.error}`).join("\n"),
        );
      }
      return result;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    refreshPendingCount();

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setIsOnline(online);
      if (online) {
        syncNow();
      }
    });

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshPendingCount();
        syncNow();
      }
    });

    // Fallback in case a NetInfo/AppState event is ever missed on some device.
    const poll = setInterval(syncNow, 60_000);

    return () => {
      unsubscribeNetInfo();
      appStateSubscription.remove();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OfflineSyncContext.Provider value={{ pendingCount, isOnline, syncing, syncNow, refreshPendingCount }}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncValue {
  return useContext(OfflineSyncContext);
}
