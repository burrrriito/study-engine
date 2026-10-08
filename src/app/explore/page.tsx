"use client";
import { useEffect, useState } from "react";
import StoryCard from "@/components/StoryCard";
import { listAllStories } from "@/lib/storage";
import { GENRES, type Genre, type Story } from "@/lib/types";

export default function ExplorePage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [genre, setGenre] = useState<Genre | "">("");
  useEffect(() => { listAllStories().then(setStories); }, []);
  const shown = stories.filter((s) => !genre || s.genre === genre);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Explore</h1>
      <p className="text-sm text-neutral-400">Browse stories in your library.</p>
      <div className="flex flex-wrap gap-2">
        {["", ...GENRES].map((g) => (
          <button key={g} onClick={() => setGenre(g as Genre | "")} className={`rounded-full border px-3 py-1 text-xs ${genre === g ? "border-amber-500 text-amber-400" : "border-neutral-800 text-neutral-400 hover:text-neutral-100"}`}>{g || "All"}</button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((s) => <StoryCard key={s.id} story={s} />)}</div>
      {shown.length === 0 && <p className="text-sm text-neutral-500">Nothing here yet.</p>}
    </div>
  );
}
