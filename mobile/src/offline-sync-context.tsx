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
      // ONLY permanent rejections interrupt the driver. A save that simply
      // couldn't reach the server stays queued and goes again by itself, so
      // alerting on it was wrong: mid-round on patchy signal it fired
      // repeatedly with a message about connectivity the driver could do
      // nothing about, and it buried the rejections that do need attention.
      // Those still show as a pending count on the run screen.
      if (result.rejected.length > 0) {
        const count = result.rejected.length;
        Alert.alert(
          count === 1 ? "A delivery was rejected" : `${count} deliveries were rejected`,
          `${result.rejected.map((failure) => `• ${failure.error}`).join("\n")}\n\nThese won't be retried — the office needs to fix the cause, then re-enter them.`,
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
