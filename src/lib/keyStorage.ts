import { cloudUserId } from "./cloud";
import { getSupabase } from "./supabase/client";

/**
 * API key persistence. Signed-in users: Supabase `user_api_keys` (RLS-scoped to auth.uid()).
 * Guests / Supabase not configured: the browser's localStorage config entry.
 * The latest keys are mirrored in an in-memory store so synchronous callers (loadConfig) never wait on the network.
 */

export const CONFIG_KEY = "story-engine:config";
const TIMEOUT_MS = 8000;

export type ApiKeyProvider = "gemini" | "openrouter";
export type KeySyncStatus = "loading" | "local" | "synced" | "saving" | "error";

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  provider: ApiKeyProvider;
  api_key: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKeys {
  gemini: string[];
  openrouter: string;
}

export interface KeySyncState extends ApiKeys {
  status: KeySyncStatus;
  /** Supabase user id when keys live in the cloud, otherwise null. */
  userId: string | null;
  error: string | null;
}

export type KeySaveResult = { ok: true } | { ok: false; error: string };

const INITIAL: KeySyncState = { status: "loading", userId: null, gemini: [], openrouter: "", error: null };
let state: KeySyncState = INITIAL;
const listeners = new Set<() => void>();
const set = (next: Partial<KeySyncState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const getKeyState = (): KeySyncState => state;
export const getServerKeyState = (): KeySyncState => INITIAL;
export function subscribeKeys(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const clean = (keys: string[]) => [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))];
const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Network error";
  // PostgREST reports a missing table as "Could not find the table ... in the schema cache".
  return /schema cache|user_api_keys.*(does not exist|not find)/i.test(m)
    ? "Cloud key storage is not set up yet. Run the user_api_keys section of supabase/schema.sql in the Supabase SQL Editor"
    : m;
};

function withTimeout<T>(p: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Request timed out")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ---- local (guest) storage ----
function readRaw(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readLocalKeys(): ApiKeys {
  const raw = readRaw();
  const legacy = typeof raw.geminiApiKey === "string" && raw.geminiApiKey ? [raw.geminiApiKey] : [];
  const gemini = Array.isArray(raw.geminiApiKeys) ? (raw.geminiApiKeys as unknown[]).map(String) : legacy;
  return { gemini: clean(gemini), openrouter: typeof raw.openRouterApiKey === "string" ? raw.openRouterApiKey.trim() : "" };
}

export function writeLocalKeys(keys: ApiKeys) {
  const { geminiApiKey: _legacy, ...raw } = readRaw(); // eslint-disable-line @typescript-eslint/no-unused-vars
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...raw, geminiApiKeys: keys.gemini, openRouterApiKey: keys.openrouter }));
}

// ---- cloud ----
const table = () => {
  const c = getSupabase();
  if (!c) throw new Error("Supabase is not configured.");
  return c.from("user_api_keys");
};

async function fetchRecords(userId: string): Promise<ApiKeyRecord[]> {
  const { data, error } = await withTimeout(
    table().select("id,user_id,provider,api_key,created_at,updated_at").eq("user_id", userId).order("created_at", { ascending: true }),
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ApiKeyRecord[];
}

/** Makes the provider's rows exactly `keys` (in order). Upserts first so a failure never leaves the user with fewer keys. */
async function replaceProvider(userId: string, provider: ApiKeyProvider, keys: string[], existing: ApiKeyRecord[]) {
  const now = Date.now();
  if (keys.length) {
    const rows = keys.map((api_key, i) => ({
      user_id: userId,
      provider,
      api_key,
      created_at: new Date(now + i).toISOString(), // preserves the key order used for rotation
      updated_at: new Date(now).toISOString(),
    }));
    const { error } = await withTimeout(table().upsert(rows, { onConflict: "user_id,provider,api_key" }));
    if (error) throw new Error(error.message);
  }
  const stale = existing.filter((r) => r.provider === provider && !keys.includes(r.api_key)).map((r) => r.id);
  if (stale.length) {
    const { error } = await withTimeout(table().delete().eq("user_id", userId).in("id", stale));
    if (error) throw new Error(error.message);
  }
}

const fromRecords = (rows: ApiKeyRecord[]): ApiKeys => ({
  gemini: rows.filter((r) => r.provider === "gemini").map((r) => r.api_key),
  openrouter: rows.find((r) => r.provider === "openrouter")?.api_key ?? "",
});

// ---- hydration ----
let hydrated = false;
let inflight: Promise<void> | null = null;
let generation = 0;

/** Forget everything (call when the signed-in user changes). */
export function resetKeys() {
  generation++;
  hydrated = false;
  inflight = null;
  set({ ...INITIAL });
}

/**
 * Loads keys for the current user into memory. Cloud keys win; local keys are uploaded automatically
 * for any provider the account has none for (first-login migration), then removed from this browser.
 * Never throws: on failure the local keys stay usable and the state becomes "error".
 */
export function hydrateKeys(force = false): Promise<void> {
  if (hydrated && !force) return Promise.resolve();
  if (inflight) return inflight;
  const gen = generation;
  const stale = () => gen !== generation;
  const run = async () => {
    const local = readLocalKeys();
    let uid: string | null = null;
    try {
      uid = await withTimeout(cloudUserId());
      if (stale()) return;
      if (!uid) {
        set({ status: "local", userId: null, error: null, ...local });
        hydrated = true;
        return;
      }
      const rows = await fetchRecords(uid);
      const cloud = fromRecords(rows);
      const merged: ApiKeys = {
        gemini: cloud.gemini.length ? cloud.gemini : local.gemini,
        openrouter: cloud.openrouter || local.openrouter,
      };
      if (!cloud.gemini.length && local.gemini.length) await replaceProvider(uid, "gemini", local.gemini, rows);
      if (!cloud.openrouter && local.openrouter) await replaceProvider(uid, "openrouter", [local.openrouter], rows);
      if (stale()) return;
      if (local.gemini.length || local.openrouter) writeLocalKeys({ gemini: [], openrouter: "" });
      set({ status: "synced", userId: uid, error: null, ...merged });
      hydrated = true;
    } catch (e) {
      if (stale()) return;
      set({ status: "error", userId: uid, error: errMsg(e), ...local });
    }
  };
  const p = run().finally(() => { if (inflight === p) inflight = null; });
  inflight = p;
  return p;
}

/** Persists the keys for the current user. Never throws; a cloud failure falls back to a local backup copy. */
export async function saveKeys(input: ApiKeys): Promise<KeySaveResult> {
  const keys: ApiKeys = { gemini: clean(input.gemini), openrouter: input.openrouter.trim() };
  if (!hydrated) await hydrateKeys(true);
  const uid = state.userId;
  if (!uid) {
    writeLocalKeys(keys);
    set({ ...keys, status: state.status === "error" ? "error" : "local" });
    return state.status === "error" ? { ok: false, error: state.error ?? "Could not reach your account." } : { ok: true };
  }
  set({ ...keys, status: "saving", error: null });
  try {
    if (!hydrated) throw new Error(state.error ?? "Could not load your account's keys.");
    const rows = await fetchRecords(uid);
    await replaceProvider(uid, "gemini", keys.gemini, rows);
    await replaceProvider(uid, "openrouter", keys.openrouter ? [keys.openrouter] : [], rows);
    writeLocalKeys({ gemini: [], openrouter: "" });
    set({ status: "synced", error: null });
    return { ok: true };
  } catch (e) {
    writeLocalKeys(keys); // keep a backup; it is re-uploaded on the next successful hydrate if the account has none
    const error = errMsg(e);
    set({ status: "error", error });
    return { ok: false, error };
  }
}

