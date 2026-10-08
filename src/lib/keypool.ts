import { formatWait, getPool, recordRequest, setCooldown, setTurnStatus } from "./usage.ts";

export class AllKeysLimitedError extends Error {
  waitMs: number;
  constructor(waitMs: number, detail?: string) {
    super(`Gemini limit reached on all keys. ${detail ? `${detail} ` : ""}Try again in ${formatWait(waitMs)}.`);
    this.waitMs = waitMs;
  }
}

export interface Fallback {
  url: string;
  /** Called once per attempted model; `model` is undefined when no `models` list is given. */
  makeBody: (model?: string) => unknown;
  /** Ordered failover models; the next one is tried when the previous fails. */
  models?: string[];
}

const RETRY_DELAY_MS = [500, 900] as const;
const jitter = () => RETRY_DELAY_MS[0] + Math.random() * (RETRY_DELAY_MS[1] - RETRY_DELAY_MS[0]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Pulls a readable message out of a failed response: JSON `{error:{message}}` / `{error:"..."}` / `{message}`, else raw text. */
async function readErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j: unknown = JSON.parse(text);
    if (j && typeof j === "object") {
      const err = (j as { error?: unknown; message?: unknown }).error ?? (j as { message?: unknown }).message;
      if (typeof err === "string") return err;
      if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") return (err as { message: string }).message;
    }
  } catch { /* not JSON */ }
  return text || String(res.status);
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function useFallback(fallback: Fallback, waitMs: number, signal?: AbortSignal, prefix = "", overloaded = false): Promise<Response> {
  let detail = prefix;
  const models: (string | undefined)[] = fallback.models?.length ? fallback.models : [undefined];
  for (const model of models) {
    try {
      const res = await fetch(fallback.url, { method: "POST", body: JSON.stringify(fallback.makeBody(model)), signal });
      if (res.ok) {
        if (overloaded) setTurnStatus("overloaded_failover");
        return res;
      }
      detail += `OpenRouter fallback${model ? ` (${model})` : ""} failed: ${(await readErrorDetail(res)).slice(0, 120)}. `;
    } catch (e) {
      if (isAbort(e)) throw e;
      detail += `OpenRouter fallback${model ? ` (${model})` : ""} failed. `;
    }
  }
  setTurnStatus("idle");
  throw new AllKeysLimitedError(waitMs, detail.trim());
}

/**
 * POSTs JSON to one of our API routes using the first key that is not cooling down.
 * - 429: the key is put on cooldown and the request is retried at once with the next key.
 * - 503: one jittered retry (500-900ms) on the same key; if that still fails with a 5xx the upstream
 *   model is overloaded, so the remaining keys are skipped and the fallback tier is used.
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
  setTurnStatus("active");
  for (;;) {
    const pool = getPool(keys, limit);
    const idx = keys.findIndex((_, i) => !pool.states[i].blocked && !tried.has(i));
    if (idx < 0) {
      const waits = pool.states.filter((s) => s.resetAt).map((s) => s.resetAt - Date.now());
      const waitMs = waits.length ? Math.min(...waits) : 60_000;
      setTurnStatus("cooldown");
      if (!fallback) throw new AllKeysLimitedError(waitMs);
      return useFallback(fallback, waitMs, signal);
    }
    tried.add(idx);
    const send = () => {
      recordRequest(keys[idx]);
      return fetch(url, { method: "POST", body: JSON.stringify(makeBody(keys[idx])), signal });
    };
    let res = await send();
    // A missing model fails identically for every key, so rotating keys is pointless: go straight to the fallback.
    if (res.status === 404 && fallback) return useFallback(fallback, 60_000, signal, "Gemini model unavailable. ");
    if (res.status === 503) {
      await sleep(jitter(), signal);
      res = await send();
      if (res.status >= 500) {
        // Capacity problem upstream: other keys would hit the same bottleneck.
        if (!fallback) { setTurnStatus("idle"); return res; }
        return useFallback(fallback, 60_000, signal, "Gemini is overloaded. ", true);
      }
    }
    if (res.status !== 429) {
      setTurnStatus("idle");
      return res;
    }
    setCooldown(keys[idx], Number(res.headers.get("Retry-After")) || 60);
  }
}
