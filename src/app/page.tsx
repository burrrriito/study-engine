"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, PlusCircle, Settings, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import StoryCard from "@/components/StoryCard";
import { deleteStory, getStory, listSessions, listStories } from "@/lib/storage";
import type { Session, Story } from "@/lib/types";

export default function HomePage() {
  const { user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [last, setLast] = useState<{ story: Story; session: Session } | null>(null);

  async function load() {
    if (!user) return;
    setStories(await listStories(user.id));
    const s = (await listSessions(user.id))[0];
    const st = s && (await getStory(s.storyId));
    setLast(st ? { story: st, session: s } : null);
  }
  useEffect(() => { load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const cta = "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm hover:border-neutral-600 sm:flex-none";
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Link href="/create" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-400 sm:w-auto"><PlusCircle size={16} /> Create New Story</Link>
        <Link href="/explore" className={cta}><Compass size={16} /> Explore</Link>
        <Link href="/settings" className={cta}><Settings size={16} /> Engine Settings</Link>
      </div>

      {last && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">Continue Story</h2>
          <div className="flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 sm:flex-row">
            <div className="aspect-video bg-neutral-800 sm:aspect-auto sm:w-72">
              {last.story.titleImage && /* eslint-disable-next-line @next/next/no-img-element */ <img src={last.story.titleImage} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="flex flex-1 flex-col gap-3 p-5">
              <h3 className="text-xl font-semibold">{last.story.title}</h3>
              <p className="text-xs text-neutral-500">{last.session.messages.length} messages · last played {new Date(last.session.lastPlayed).toLocaleString()}</p>
              <p className="line-clamp-3 text-sm text-neutral-400">
                {last.session.memory.temporary || last.session.memory.longTerm || last.story.description}
              </p>
              <Link href={`/play/${last.story.id}`} className="mt-auto flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 sm:w-fit">Resume</Link>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">My Stories</h2>
        {stories.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">No stories yet. Create your first one.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => (
              <div key={s.id} className="relative">
                <StoryCard story={s} />
                <button title="Delete" aria-label="Delete story" onClick={async () => { if (confirm(`Delete "${s.title}" and its saves?`)) { await deleteStory(s.id); load(); } }} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg bg-black/60 text-neutral-300 hover:text-red-400 sm:h-9 sm:w-9"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
