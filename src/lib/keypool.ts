import { formatWait, getPool, recordRequest, setCooldown, setTurnStatus } from "./usage.ts";

export class AllKeysLimitedError extends Error {
  waitMs: number;
  constructor(waitMs: number, detail?: string) {
    super(`${detail ? `${detail} ` : "Gemini limit reached on all keys. "}Try again in ${formatWait(waitMs)}.`);
    this.waitMs = waitMs;
  }
}

export interface Fallback {
  url: string;
  /** Called once per attempted model; `model` is undefined when no `models` list is given. */
  makeBody: (model?: string) => unknown;
  /** Ordered failover models (or a resolver for them); the next one is tried when the previous fails. */
  models?: string[] | (() => Promise<string[]>);
}

interface OpenRouterModel {
  id?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODELS_TTL_MS = 60 * 60 * 1000;
const MAX_FALLBACK_ATTEMPTS = 5;
let modelCache: { at: number; ids: string[] } | null = null;

const isFree = (m: OpenRouterModel) =>
  typeof m.id === "string" && ((String(m.pricing?.prompt) === "0" && String(m.pricing?.completion) === "0") || m.id.endsWith(":free"));
const hasText = (v: unknown) => !Array.isArray(v) || v.includes("text");

/** Currently free, text-in/text-out OpenRouter models (largest context first), cached in memory for 1 hour. Never throws. */
export async function getFreeOpenRouterModels(signal?: AbortSignal): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < MODELS_TTL_MS) return modelCache.ids;
  try {
    const res = await fetch(MODELS_URL, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: OpenRouterModel[] };
    const ids = (json.data ?? [])
      .filter((m) => isFree(m) && hasText(m.architecture?.input_modalities) && hasText(m.architecture?.output_modalities))
      .sort((a, b) => (Number(b.context_length) || 0) - (Number(a.context_length) || 0))
      .map((m) => m.id as string);
    if (ids.length) modelCache = { at: Date.now(), ids };
    return ids;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    console.error("OpenRouter model discovery failed:", e);
    return modelCache?.ids ?? [];
  }
}

/** Test hook. */
export const clearModelCache = () => { modelCache = null; };

const RETRY_DELAY_MS = [600, 900] as const;
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

/** Logs the exact status/body of a failed Gemini call before any cooldown or failover decision is made. */
async function logFailure(res: Response) {
  const errorBody = (await res.clone().text().catch(() => "")).slice(0, 1000);
  console.error("Gemini API Error:", res.status, errorBody);
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function fallbackToOpenRouter(fallback: Fallback, waitMs: number, signal?: AbortSignal, prefix = "", overloaded = false): Promise<Response> {
  let detail = prefix;
  const list = typeof fallback.models === "function" ? await fallback.models().catch(() => []) : fallback.models ?? [];
  const models: (string | undefined)[] = list.length ? list.slice(0, MAX_FALLBACK_ATTEMPTS) : [undefined];
  if (!list.length && typeof fallback.models === "function") detail += "No free OpenRouter models are currently available. ";
  for (const model of models) {
    try {
      const res = await fetch(fallback.url, { method: "POST", body: JSON.stringify(fallback.makeBody(model)), signal });
      if (res.ok) {
        if (overloaded) setTurnStatus("overloaded_failover");
        return res;
      }
      const reason = (await readErrorDetail(res)).slice(0, 200);
      console.error("OpenRouter API Error:", model, res.status, reason);
      detail += `OpenRouter fallback${model ? ` (${model})` : ""} failed (${res.status}): ${reason.slice(0, 120)}. `;
    } catch (e) {
      if (isAbort(e)) throw e;
      console.error("OpenRouter request error:", model, e);
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
  let authFailure: Response | null = null;
  for (;;) {
    const pool = getPool(keys, limit);
    const idx = keys.findIndex((_, i) => !pool.states[i].blocked && !tried.has(i));
    if (idx < 0) {
      const waits = pool.states.filter((s) => s.resetAt).map((s) => s.resetAt - Date.now());
      if (authFailure) { setTurnStatus("idle"); return authFailure; }
      const waitMs = waits.length ? Math.min(...waits) : 60_000;
      setTurnStatus("cooldown");
      if (!fallback) throw new AllKeysLimitedError(waitMs);
      return fallbackToOpenRouter(fallback, waitMs, signal, "Gemini rate limit reached on all keys. ");
    }
    tried.add(idx);
    const send = () => {
      recordRequest(keys[idx]);
      return fetch(url, { method: "POST", body: JSON.stringify(makeBody(keys[idx])), signal });
    };
    let res = await send();
    if (!res.ok) await logFailure(res);
    // A missing model fails identically for every key, so rotating keys is pointless: go straight to the fallback.
    if (res.status === 404 && fallback) return fallbackToOpenRouter(fallback, 60_000, signal, "Gemini model unavailable. ");
    if (res.status === 503) {
      await sleep(jitter(), signal);
      res = await send();
      if (!res.ok) await logFailure(res);
      if (res.status >= 500) {
        // Capacity problem upstream: other keys would hit the same bottleneck.
        if (!fallback) { setTurnStatus("idle"); return res; }
        return fallbackToOpenRouter(fallback, 60_000, signal, "Gemini is overloaded. ", true);
      }
    }
    // A rejected key (401/403) only affects that key: try the next one, without cooling anything down.
    if (res.status === 401 || res.status === 403) {
      authFailure = res;
      continue;
    }
    // Other statuses (400 bad request, 5xx, ...) are not rate limits: no cooldown, no rotation.
    if (res.status !== 429) {
      setTurnStatus("idle");
      return res;
    }
    setCooldown(keys[idx], Number(res.headers.get("Retry-After")) || 60);
  }
}


