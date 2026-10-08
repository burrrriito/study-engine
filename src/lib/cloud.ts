import type { Memory, MediaItem, Session, Story } from "./types";
import { MEDIA_BUCKET, getSupabase } from "./supabase/client";

/** Signed-in Supabase user id, or null (guest / Supabase not configured). */
export async function cloudUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  fail(sessionError);
  if (!sessionData.session) return null;
  const { data, error } = await sb.auth.getUser();
  fail(error);
  return data.user?.id ?? null;
}

export async function syncProfile(user: { id: string; email?: string }) {
  const { error } = await sb().from("profiles").upsert({
    id: user.id,
    email: user.email ?? "",
    updated_at: new Date().toISOString(),
  });
  fail(error);
}

const sb = () => {
  const c = getSupabase();
  if (!c) throw new Error("Supabase is not configured.");
  return c;
};
const ms = (iso: string) => new Date(iso).getTime();
const iso = (t: number) => new Date(t).toISOString();
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const toStory = (r: any): Story => ({
  id: r.id,
  ownerId: r.user_id,
  title: r.title,
  titleImage: r.title_image_url,
  description: r.description,
  genre: r.genre,
  mode: r.mode,
  systemPrompt: r.system_prompt,
  plotExamples: r.plot_examples ?? [],
  prologue: r.prologue,
  openingScene: r.opening_scene,
  initialSuggestions: r.initial_suggestions ?? [],
  mediaGallery: (r.story_media ?? []).map((m: any): MediaItem => ({ id: m.id, imageUrl: m.image_url, triggerHint: m.trigger_hint })),
  plays: r.plays ?? 0,
  createdAt: ms(r.created_at),
  updatedAt: ms(r.updated_at),
});

const toSession = (r: any): Session => ({
  id: r.id,
  storyId: r.story_id,
  ownerId: r.user_id,
  messages: r.messages ?? [],
  memory: r.memory as Memory,
  directorNotes: r.director_notes,
  imagesEnabled: r.images_enabled,
  lastPlayed: ms(r.last_played),
});

const SELECT = "*, story_media(*)";

export async function listStories(userId: string): Promise<Story[]> {
  const { data, error } = await sb().from("stories").select(SELECT).eq("user_id", userId).order("updated_at", { ascending: false });
  fail(error);
  return (data ?? []).map(toStory);
}

export async function getStory(id: string): Promise<Story | undefined> {
  const { data, error } = await sb().from("stories").select(SELECT).eq("id", id).maybeSingle();
  fail(error);
  return data ? toStory(data) : undefined;
}

export async function uploadStoryImage(file: File, userId: string, storyId: string): Promise<string> {
  const ext = (file.type.split("/")[1] || "png").replace("+xml", "").replace("jpeg", "jpg");
  const path = `${userId}/${storyId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb().storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  });
  fail(error);
  return sb().storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Uploads a base64 data URL to Storage and returns its public URL; other URLs pass through. */
async function ensureUploaded(url: string, path: string): Promise<string> {
  if (!url.startsWith("data:")) return url;
  const blob = dataUrlToBlob(url);
  const ext = (blob.type.split("/")[1] || "png").replace("+xml", "").replace("jpeg", "jpg");
  const full = `${path}.${ext}`;
  const { error } = await sb().storage.from(MEDIA_BUCKET).upload(full, blob, { upsert: true, contentType: blob.type, cacheControl: "31536000" });
  fail(error);
  return sb().storage.from(MEDIA_BUCKET).getPublicUrl(full).data.publicUrl;
}

export async function saveStory(s: Story, userId: string): Promise<Story> {
  const base = `${userId}/${s.id}`;
  const titleImage = s.titleImage ? await ensureUploaded(s.titleImage, `${base}/cover-${Date.now()}`) : "";
  const gallery: MediaItem[] = [];
  for (const m of s.mediaGallery) gallery.push({ ...m, imageUrl: await ensureUploaded(m.imageUrl, `${base}/${m.id}-${Date.now()}`) });

  const { error } = await sb().from("stories").upsert({
    id: s.id,
    user_id: userId,
    title: s.title,
    title_image_url: titleImage,
    description: s.description,
    genre: s.genre,
    mode: s.mode,
    system_prompt: s.systemPrompt,
    plot_examples: s.plotExamples,
    prologue: s.prologue,
    opening_scene: s.openingScene,
    initial_suggestions: s.initialSuggestions,
    plays: s.plays,
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
  });
  fail(error);

  const keep = gallery.map((m) => m.id);
  const del = sb().from("story_media").delete().eq("story_id", s.id);
  fail((keep.length ? await del.not("id", "in", `(${keep.join(",")})`) : await del).error);
  if (gallery.length) {
    const { error: e } = await sb().from("story_media").upsert(gallery.map((m) => ({ id: m.id, story_id: s.id, image_url: m.imageUrl, trigger_hint: m.triggerHint })));
    fail(e);
  }
  return { ...s, ownerId: userId, titleImage, mediaGallery: gallery };
}

export async function deleteStory(id: string, userId: string) {
  const { error } = await sb().from("stories").delete().eq("id", id);
  fail(error);
  const folder = `${userId}/${id}`;
  const { data, error: listError } = await sb().storage.from(MEDIA_BUCKET).list(folder);
  fail(listError);
  if (data?.length) {
    const { error: removeError } = await sb().storage.from(MEDIA_BUCKET).remove(data.map((f) => `${folder}/${f.name}`));
    fail(removeError);
  }
}

export async function listSessions(userId: string): Promise<Session[]> {
  const { data, error } = await sb().from("sessions").select("*").eq("user_id", userId).order("last_played", { ascending: false });
  fail(error);
  return (data ?? []).map(toSession);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const { data, error } = await sb().from("sessions").select("*").eq("id", id).maybeSingle();
  fail(error);
  return data ? toSession(data) : undefined;
}

export async function getLatestSessionForStory(storyId: string, userId: string): Promise<Session | undefined> {
  const { data, error } = await sb().from("sessions").select("*").eq("story_id", storyId).eq("user_id", userId).order("last_played", { ascending: false }).limit(1);
  fail(error);
  return data?.[0] ? toSession(data[0]) : undefined;
}

export async function saveSession(s: Session, userId: string) {
  const { error } = await sb().from("sessions").upsert({
    id: s.id,
    user_id: userId,
    story_id: s.storyId,
    messages: s.messages,
    memory: s.memory,
    director_notes: s.directorNotes,
    images_enabled: s.imagesEnabled,
    last_played: iso(s.lastPlayed),
  });
  fail(error);
}