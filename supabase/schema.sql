-- Story Engine: run once in Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  title_image_url text not null default '',
  description text not null default '',
  genre text not null default '',
  mode text not null default 'Basic',
  system_prompt text not null default '',
  plot_examples jsonb not null default '[]'::jsonb,
  prologue text not null default '',
  opening_scene text not null default '',
  initial_suggestions jsonb not null default '[]'::jsonb,
  plays integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.story_media (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  image_url text not null,
  trigger_hint text not null default ''
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  memory jsonb not null default '{"longTerm":"","temporary":"","relationships":"","goals":""}'::jsonb,
  director_notes text not null default '',
  images_enabled boolean not null default false,
  last_played timestamptz not null default now()
);

create index if not exists stories_user_idx on public.stories(user_id, updated_at desc);
create index if not exists story_media_story_idx on public.story_media(story_id);
create index if not exists sessions_user_story_idx on public.sessions(user_id, story_id, last_played desc);

alter table public.profiles enable row level security;
alter table public.stories enable row level security;
alter table public.story_media enable row level security;
alter table public.sessions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_own" on public.profiles for delete to authenticated using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do update set email = excluded.email;

drop policy if exists "stories_select_own" on public.stories;
drop policy if exists "stories_insert_own" on public.stories;
drop policy if exists "stories_update_own" on public.stories;
drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_select_own" on public.stories for select to authenticated using (user_id = auth.uid());
create policy "stories_insert_own" on public.stories for insert to authenticated with check (user_id = auth.uid());
create policy "stories_update_own" on public.stories for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "stories_delete_own" on public.stories for delete to authenticated using (user_id = auth.uid());

drop policy if exists "story_media_select_own" on public.story_media;
drop policy if exists "story_media_insert_own" on public.story_media;
drop policy if exists "story_media_update_own" on public.story_media;
drop policy if exists "story_media_delete_own" on public.story_media;
create policy "story_media_select_own" on public.story_media for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()));
create policy "story_media_insert_own" on public.story_media for insert to authenticated
  with check (exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()));
create policy "story_media_update_own" on public.story_media for update to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()));
create policy "story_media_delete_own" on public.story_media for delete to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()));

drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_insert_own" on public.sessions;
drop policy if exists "sessions_update_own" on public.sessions;
drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_select_own" on public.sessions for select to authenticated using (user_id = auth.uid());
create policy "sessions_insert_own" on public.sessions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()));
create policy "sessions_update_own" on public.sessions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid()));
create policy "sessions_delete_own" on public.sessions for delete to authenticated using (user_id = auth.uid());

-- Storage: public bucket; files live under <user_id>/<story_id>/<file>
insert into storage.buckets (id, name, public) values ('story-media', 'story-media', true)
on conflict (id) do update set public = true;

drop policy if exists "story_media_objects_read" on storage.objects;
drop policy if exists "story_media_objects_upload" on storage.objects;
drop policy if exists "story_media_objects_update" on storage.objects;
drop policy if exists "story_media_objects_delete" on storage.objects;
create policy "story_media_objects_read" on storage.objects for select using (bucket_id = 'story-media');
create policy "story_media_objects_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'story-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "story_media_objects_update" on storage.objects for update to authenticated
  using (bucket_id = 'story-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "story_media_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'story-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- API keys (per user, per provider; several Gemini keys allowed, ordered by created_at).
create table if not exists public.user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gemini', 'openrouter')),
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, api_key)
);
create index if not exists user_api_keys_user_idx on public.user_api_keys(user_id, provider, created_at);

alter table public.user_api_keys enable row level security;
drop policy if exists "user_api_keys_select_own" on public.user_api_keys;
drop policy if exists "user_api_keys_insert_own" on public.user_api_keys;
drop policy if exists "user_api_keys_update_own" on public.user_api_keys;
drop policy if exists "user_api_keys_delete_own" on public.user_api_keys;
create policy "user_api_keys_select_own" on public.user_api_keys for select to authenticated using (auth.uid() = user_id);
create policy "user_api_keys_insert_own" on public.user_api_keys for insert to authenticated with check (auth.uid() = user_id);
create policy "user_api_keys_update_own" on public.user_api_keys for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_api_keys_delete_own" on public.user_api_keys for delete to authenticated using (auth.uid() = user_id);
