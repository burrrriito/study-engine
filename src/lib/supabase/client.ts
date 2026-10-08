import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MEDIA_BUCKET = "story-media";

let client: SupabaseClient | null = null;

/** Browser Supabase client, or null when the env vars are missing (app falls back to local-only mode). */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return (client ??= createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!));
}