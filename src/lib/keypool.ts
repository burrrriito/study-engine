import { formatWait, getPool, recordRequest, setCooldown } from "./usage.ts";

export class AllKeysLimitedError extends Error {
  waitMs: number;
  constructor(waitMs: number, detail?: string) {
    super(`Gemini limit reached on all keys. ${detail ? `${detail} ` : ""}Try again in ${formatWait(waitMs)}.`);
    this.waitMs = waitMs;
  }
}

export interface Fallback {
  url: string;
  makeBody: () => unknown;
}

async function useFallback(fallback: Fallback, waitMs: number, signal?: AbortSignal, prefix = ""): Promise<Response> {
  let detail = prefix;
  try {
    const res = await fetch(fallback.url, { method: "POST", body: JSON.stringify(fallback.makeBody()), signal });
    if (res.ok) return res;
    detail += `OpenRouter fallback failed: ${(await res.text().catch(() => "")).slice(0, 120) || res.status}.`;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    detail += "OpenRouter fallback failed.";
  }
  throw new AllKeysLimitedError(waitMs, detail);
}

/**
 * POSTs JSON to one of our API routes using the first key that is not cooling down.
 * On a 429 the key is put on cooldown and the request is retried at once with the next key.
 * When every key is limited and a fallback is given, the request is forwarded there instead.
 */
export async function fetchWithKeys(
  url: string,
  keys: string[],
  limit: number,
  makeBody: (apiKey: string) => unknown,
  opts: { signal?: AbortSignal; fallback?: Fallback | null } = {},
): Promise<Response> {
  const { signal, fallback } = opts;
  const tried = new Set<number>();
  for (;;) {
    const pool = getPool(keys, limit);
    const idx = keys.findIndex((_, i) => !pool.states[i].blocked && !tried.has(i));
    if (idx < 0) {
      const waits = pool.states.filter((s) => s.resetAt).map((s) => s.resetAt - Date.now());
      const waitMs = waits.length ? Math.min(...waits) : 60_000;
      if (!fallback) throw new AllKeysLimitedError(waitMs);
      return useFallback(fallback, waitMs, signal);
    }
    tried.add(idx);
    recordRequest(keys[idx]);
    const res = await fetch(url, { method: "POST", body: JSON.stringify(makeBody(keys[idx])), signal });
    // A missing model fails identically for every key, so rotating keys is pointless: go straight to the fallback.
    if (res.status === 404 && fallback) return useFallback(fallback, 60_000, signal, "Gemini model unavailable. ");
    if (res.status !== 429) return res;
    setCooldown(keys[idx], Number(res.headers.get("Retry-After")) || 60);
  }
}