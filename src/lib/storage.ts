import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Story, Session, GMConfig, User } from "./types";
import { DEFAULT_CONFIG } from "./defaults";
import * as cloud from "./cloud";
import { cloudUserId } from "./cloud";
import { CONFIG_KEY, getKeyState, readLocalKeys, saveKeys, writeLocalKeys, type KeySaveResult } from "./keyStorage";

const NS = "story-engine";
const K = { users: `${NS}:users`, session: `${NS}:auth` };

interface DB extends DBSchema {
  stories: { key: string; value: Story; indexes: { ownerId: string } };
  sessions: { key: string; value: Session; indexes: { storyId: string; ownerId: string } };
}

let dbp: Promise<IDBPDatabase<DB>> | null = null;
const db = () =>
  (dbp ??= openDB<DB>(`${NS}-db`, 1, {
    upgrade(d) {
      d.createObjectStore("stories", { keyPath: "id" }).createIndex("ownerId", "ownerId");
      const s = d.createObjectStore("sessions", { keyPath: "id" });
      s.createIndex("storyId", "storyId");
      s.createIndex("ownerId", "ownerId");
    },
  }));

// Cloud (Supabase) when signed in; otherwise the local IndexedDB below.
export const listStories = async (ownerId: string) => {
  if (await cloudUserId()) return cloud.listStories(ownerId);
  return (await (await db()).getAllFromIndex("stories", "ownerId", ownerId)).sort((a, b) => b.updatedAt - a.updatedAt);
};
export const getStory = async (id: string) => ((await cloudUserId()) ? cloud.getStory(id) : (await db()).get("stories", id));
export const saveStory = async (s: Story): Promise<Story> => {
  const uid = await cloudUserId();
  if (uid) return cloud.saveStory(s, uid);
  await (await db()).put("stories", s);
  return s;
};
export const deleteStory = async (id: string) => {
  const uid = await cloudUserId();
  if (uid) return cloud.deleteStory(id, uid);
  const d = await db();
  await d.delete("stories", id);
  for (const k of await d.getAllKeysFromIndex("sessions", "storyId", id)) await d.delete("sessions", k);
};
export const listSessions = async (ownerId: string) => {
  if (await cloudUserId()) return cloud.listSessions(ownerId);
  return (await (await db()).getAllFromIndex("sessions", "ownerId", ownerId)).sort((a, b) => b.lastPlayed - a.lastPlayed);
};
export const getSession = async (id: string) => ((await cloudUserId()) ? cloud.getSession(id) : (await db()).get("sessions", id));
export const getLatestSessionForStory = async (storyId: string, ownerId: string) => {
  if (await cloudUserId()) return cloud.getLatestSessionForStory(storyId, ownerId);
  return (await (await db()).getAllFromIndex("sessions", "storyId", storyId)).filter((s) => s.ownerId === ownerId).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
};
export const saveSession = async (s: Session) => {
  const uid = await cloudUserId();
  if (uid) return cloud.saveSession(s, uid);
  await (await db()).put("sessions", s);
};
// ---- config ----
// API keys are persisted by keyStorage (Supabase when signed in, localStorage otherwise); everything else lives in localStorage.
export function loadConfig(): GMConfig {
  let rest: Record<string, unknown> = {};
  try {
    const { geminiApiKey: _a, geminiApiKeys: _b, openRouterApiKey: _c, ...r } = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); // eslint-disable-line @typescript-eslint/no-unused-vars
    rest = r;
  } catch { /* use defaults */ }
  const s = getKeyState();
  const keys = s.userId ? { gemini: s.gemini, openrouter: s.openrouter } : readLocalKeys();
  return { ...DEFAULT_CONFIG, ...rest, geminiApiKeys: keys.gemini, openRouterApiKey: keys.openrouter };
}
export async function saveConfig(c: GMConfig): Promise<KeySaveResult> {
  const { geminiApiKeys, openRouterApiKey, ...rest } = c;
  // Keys are left to keyStorage; keep whatever it currently has locally.
  writeLocalKeys(readLocalKeys());
  const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...raw, ...rest }));
  return saveKeys({ gemini: geminiApiKeys, openrouter: openRouterApiKey ?? "" });
}
// ---- mock auth (client-side only; PBKDF2-hashed passwords) ----
interface StoredUser extends User { salt: string; hash: string }
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));
async function hash(pw: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: 100000, hash: "SHA-256" }, key, 256);
  return b64(bits);
}
const users = (): StoredUser[] => { try { return JSON.parse(localStorage.getItem(K.users) || "[]"); } catch { return []; } };

export async function register(email: string, password: string): Promise<User> {
  email = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const list = users();
  if (list.some((u) => u.email === email)) throw new Error("An account with this email already exists.");
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const u: StoredUser = { id: crypto.randomUUID(), email, salt, hash: await hash(password, salt) };
  localStorage.setItem(K.users, JSON.stringify([...list, u]));
  return setSession(u);
}
export async function login(email: string, password: string): Promise<User> {
  email = email.trim().toLowerCase();
  const u = users().find((x) => x.email === email);
  if (!u || (await hash(password, u.salt)) !== u.hash) throw new Error("Invalid email or password.");
  return setSession(u);
}
function setSession(u: StoredUser): User {
  const user = { id: u.id, email: u.email };
  localStorage.setItem(K.session, JSON.stringify(user));
  return user;
}
export function currentUser(): User | null { try { return JSON.parse(localStorage.getItem(K.session) || "null"); } catch { return null; } }
export const logout = () => localStorage.removeItem(K.session);

export function fileToBase64(file: File, maxBytes: number): Promise<string> {
  return new Promise((res, rej) => {
    if (!file.type.startsWith("image/")) return rej(new Error("File must be an image."));
    if (file.size > maxBytes) return rej(new Error("Image exceeds 5MB."));
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read file."));
    r.readAsDataURL(file);
  });
}

export async function storeStoryImage(file: File, maxBytes: number, storyId: string): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("File must be an image.");
  if (file.size > maxBytes) throw new Error("Image exceeds 5MB.");
  const uid = await cloudUserId();
  if (uid) return cloud.uploadStoryImage(file, uid, storyId);
  return fileToBase64(file, maxBytes);
}

export const listAllStories = async (ownerId?: string) => {
  const uid = await cloudUserId();
  if (uid) return cloud.listStories(uid);
  return (await (await db()).getAll("stories")).sort((a, b) => b.updatedAt - a.updatedAt);
};

/** Copies local stories not yet present in the cloud and their sessions on sign-in. */
export async function importLocalToCloud(localOwnerId: string): Promise<number> {
  const uid = await cloudUserId();
  if (!uid) return 0;
  const d = await db();
  const stories = await d.getAllFromIndex("stories", "ownerId", localOwnerId);
  const isUuid = (x: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  for (const s of stories) {
    if (await cloud.getStory(s.id)) continue;
    // Older local scene-image ids were short; the cloud schema needs UUIDs, so remap them (and any [Image: id] tags in history).
    const remap = new Map(s.mediaGallery.filter((m) => !isUuid(m.id)).map((m) => [m.id, crypto.randomUUID()]));
    const fix = (t: string) => t.replace(/\[Image:\s*([^\]\s]+)\s*\]/gi, (all, id: string) => (remap.has(id) ? `[Image: ${remap.get(id)}]` : all));
    const saved = await cloud.saveStory({ ...s, ownerId: uid, mediaGallery: s.mediaGallery.map((m) => ({ ...m, id: remap.get(m.id) ?? m.id })) }, uid);
    await d.put("stories", {
      ...s,
      titleImage: saved.titleImage,
      mediaGallery: s.mediaGallery.map((m, i) => ({ ...m, imageUrl: saved.mediaGallery[i]?.imageUrl ?? m.imageUrl })),
    });
    for (const ses of await d.getAllFromIndex("sessions", "storyId", s.id)) {
      await cloud.saveSession({ ...ses, ownerId: uid, messages: ses.messages.map((m) => ({ ...m, content: fix(m.content) })) }, uid);
    }
  }
  return stories.length;
}

