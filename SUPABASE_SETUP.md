# Supabase setup

Story Engine uses Supabase Auth, Postgres, and Storage for signed-in accounts. Gemini and OpenRouter API keys are stored in the `user_api_keys` table (RLS: each user can only read/write their own rows) when signed in, and in the browser's `story-engine:config` localStorage entry for guests. Keys saved locally before sign-in are uploaded automatically on first login and then removed from the browser. Keys are stored as plain text protected by RLS (not application-level encryption), so anyone with access to your Supabase project's service role or database can read them.

## Configure Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste the complete [`supabase/schema.sql`](./supabase/schema.sql) migration, and run it. This creates the profile/story/session tables, user-scoped RLS policies, and the public `story-media` bucket with authenticated owner-folder upload/delete policies.
3. In **Authentication > URL Configuration**, set the Site URL to your deployed app URL. Add your local URL (for example `http://localhost:3000/**`) and deployed URL to the redirect allow list.
4. In **Project Settings > API**, copy the Project URL and the publishable/anon key. The app only needs the public anon key; do not put the `service_role` key in the app.
5. Paste those two public values into `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
   ```

   Restart `npm run dev` after changing environment variables. If Supabase is not configured, the app continues in local browser-only mode.

## Configure Vercel

1. Import the repository into Vercel and set **Root Directory** to `story-engine`.
2. In **Project Settings > Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the same public values. Enable them for the required environments.
3. Set Supabase Auth's Site URL and redirect allow list to the Vercel production URL and any preview URLs you intend to use.
4. Redeploy after changing environment variables.

The SQL migration is idempotent for the tables, policies, bucket, and trigger. Run it as a Supabase project administrator. RLS scopes private profile, story, scene-media metadata, and session rows to `auth.uid()`. The Storage bucket is public for image display; writes/deletes are still restricted to authenticated files under the caller's `<user_id>/` folder.

## Data behavior

- Signed-in data is read/written through Supabase; guest or local-only accounts continue to use IndexedDB.
- Existing browser-local stories/sessions are copied to Supabase once on sign-in. Local data is retained on the device.
- Story images selected while signed in upload directly from the browser to Storage. Existing local base64 images are uploaded when their story is first synced.
- Gemini/OpenRouter keys and usage/cooldown state remain browser-local and are not synchronized.

