"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// A thin colour bar that appears only while the screen is waiting.
//
// It is driven by React transitions rather than by guessing at route events,
// which means it covers the two things that actually make this app wait: a
// navigation to a new set of search params, and a server action in flight.
//
// One consequence worth knowing: a plain <form action="/path"> is a NATIVE
// browser navigation, so the page unloads and no React component can animate
// across it. Anything that wants this bar has to navigate through `navigate`
// below instead — which also avoids a full document reload.

type LoadingBarValue = {
  navigate: (href: string) => void;
  /** Mark a non-navigation wait, e.g. a server action. Returns a stop function. */
  setBusy: (busy: boolean) => void;
  isLoading: boolean;
};

const LoadingBarContext = createContext<LoadingBarValue | null>(null);

export function useLoadingBar(): LoadingBarValue {
  const value = useContext(LoadingBarContext);

  if (!value) {
    throw new Error("useLoadingBar must be used inside a LoadingBarProvider");
  }

  return value;
}

export function LoadingBarProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => router.push(href));
    },
    [router],
  );

  const value = useMemo<LoadingBarValue>(
    () => ({ navigate, setBusy, isLoading: isPending || busy }),
    [navigate, isPending, busy],
  );

  return (
    <LoadingBarContext.Provider value={value}>
      <LoadingBar />
      {children}
    </LoadingBarContext.Provider>
  );
}

// Pinned to the very top of the viewport, across the sidebar and top bar
// alike — the page as a whole is what is waiting, not one column of it.
//
// z-index sits above the dialog layer (z-50) on purpose: a deposit is saved
// with its dialog still open, and the bar has to be visible for the wait it is
// actually reporting.
function LoadingBar() {
  const { isLoading } = useLoadingBar();

  return (
    <div
      aria-hidden={!isLoading}
      role="status"
      aria-live="polite"
      aria-label={isLoading ? "Loading" : undefined}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px]"
    >
      {isLoading ? (
        <>
          <div className="loading-bar-track h-full w-full overflow-hidden">
            <div className="loading-bar-sweep h-full w-2/5" />
          </div>
          {/* Colours come from the active theme's accent plus two derived hues,
              so the bar stays multi-coloured across all four themes instead of
              fighting whichever one is on. A reduced-motion preference gets a
              still bar rather than nothing, so the waiting state is not lost. */}
          <style>{`
            .loading-bar-track {
              background: color-mix(in srgb, var(--accent) 18%, transparent);
            }
            .loading-bar-sweep {
              background: linear-gradient(
                90deg,
                transparent 0%,
                color-mix(in srgb, var(--accent) 85%, #7c5cff) 25%,
                var(--accent) 50%,
                color-mix(in srgb, var(--accent) 70%, #22c1a4) 75%,
                transparent 100%
              );
              animation: loading-bar-sweep 1.1s ease-in-out infinite;
            }
            @keyframes loading-bar-sweep {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(350%); }
            }
            @media (prefers-reduced-motion: reduce) {
              .loading-bar-sweep { animation: none; width: 100%; opacity: 0.85; }
            }
          `}</style>
        </>
      ) : null}
    </div>
  );
}
