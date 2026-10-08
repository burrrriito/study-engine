import Link from "next/link";
import { Play } from "lucide-react";
import type { Story } from "@/lib/types";

export default function StoryCard({ story }: { story: Story }) {
  return (
    <Link href={`/play/${story.id}`} className="group block overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600">
      <div className="relative aspect-video bg-neutral-800">
        {story.titleImage && /* eslint-disable-next-line @next/next/no-img-element */ <img src={story.titleImage} alt="" className="h-full w-full object-cover" />}
        <span className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex"><Play className="text-amber-400" /></span>
      </div>
      <div className="space-y-2 p-3">
        <h3 className="truncate font-medium">{story.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-400">{story.genre}</span>
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-400">{story.mode}</span>
          <span className="ml-auto text-neutral-500">{story.plays} plays</span>
        </div>
        <p className="line-clamp-2 text-sm text-neutral-400">{story.description}</p>
      </div>
    </Link>
  );
}
