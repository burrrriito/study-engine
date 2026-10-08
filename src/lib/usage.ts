// Gemini does not expose remaining quota, so usage is tracked locally per API key as a sliding 60s
// request window plus a cooldown set from the API's own 429 retry delay.
const STORE = "story-engine:usage:v2";
const WINDOW_MS = 60_000;

interface KeyUsage { hits: number[]; cooldownUntil: number }
type Store = Record<string, KeyUsage>;

/** Non-reversible-enough label for a key; only its tail is used to tell keys apart. */
export const fingerprint = (key: string) => key.trim().slice(-8);

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "{}");
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}
const entry = (s: Store, key: string): KeyUsage => {
  const e = s[fingerprint(key)];
  return { hits: Array.isArray(e?.hits) ? e.hits : [], cooldownUntil: Number(e?.cooldownUntil) || 0 };
};
const put = (s: Store, key: string, e: KeyUsage) => localStorage.setItem(STORE, JSON.stringify({ ...s, [fingerprint(key)]: e }));

export function recordRequest(key: string) {
  const now = Date.now();
  const s = read();
  const e = entry(s, key);
  put(s, key, { ...e, hits: [...e.hits.filter((t) => now - t < WINDOW_MS), now] });
}

export function setCooldown(key: string, seconds: number) {
  const s = read();
  put(s, key, { ...entry(s, key), cooldownUntil: Date.now() + Math.max(1, seconds) * 1000 });
}

export interface UsageState {
  used: number;
  limit: number;
  /** ms epoch when capacity frees up again (0 if nothing pending). */
  resetAt: number;
  blocked: boolean;
}

export function getUsage(key: string, limit: number, now = Date.now()): UsageState {
  const e = entry(read(), key);
  const hits = e.hits.filter((t) => now - t < WINDOW_MS);
  if (e.cooldownUntil > now) return { used: limit, limit, resetAt: e.cooldownUntil, blocked: true };
  const full = hits.length >= limit;
  // When full, the next slot frees when the oldest counted request expires.
  const resetAt = hits.length ? (full ? hits[hits.length - limit] : hits[0]) + WINDOW_MS : 0;
  return { used: hits.length, limit, resetAt, blocked: full };
}

export interface PoolState {
  /** Index of the key that will serve the next request (first one not cooling down), or -1. */
  active: number;
  states: UsageState[];
  /** Earliest time any key frees up, when every key is blocked. */
  nextResetAt: number;
}

export function getPool(keys: string[], limit: number, now = Date.now()): PoolState {
  const states = keys.map((k) => getUsage(k, limit, now));
  const active = states.findIndex((s) => !s.blocked);
  const nextResetAt = active >= 0 ? 0 : Math.min(...states.map((s) => s.resetAt));
  return { active, states, nextResetAt };
}

export type GeminiStatus = "idle" | "active" | "cooldown" | "overloaded_failover";

export const STATUS_EVENT = "story-engine:gemini-status";
let turnStatus: GeminiStatus = "idle";

export const getTurnStatus = (): GeminiStatus => turnStatus;

/** Records the state of the latest turn and notifies listeners (e.g. the HUD). */
export function setTurnStatus(status: GeminiStatus) {
  turnStatus = status;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<GeminiStatus>(STATUS_EVENT, { detail: status }));
}

export function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 90) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}