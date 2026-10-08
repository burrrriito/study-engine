"use client";
import { useEffect, useSyncExternalStore } from "react";
import { getKeyState, getServerKeyState, hydrateKeys, subscribeKeys, type KeySyncState } from "./keyStorage";

/** Live key-sync state; triggers hydration on mount (deduplicated). */
export function useApiKeys(): KeySyncState {
  const s = useSyncExternalStore(subscribeKeys, getKeyState, getServerKeyState);
  useEffect(() => { void hydrateKeys(); }, []);
  return s;
}
