"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Gauge, KeyRound } from "lucide-react";
import { formatWait, getPool, type PoolState } from "@/lib/usage";

export default function UsageMeter({ keys, limit }: { keys: string[]; limit: number }) {
  const [pool, setPool] = useState<PoolState | null>(null);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const sig = keys.join("|");
  useEffect(() => {
    const tick = () => { setNow(Date.now()); setPool(getPool(keys, limit)); };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, limit]);
  if (!pool || keys.length === 0) return null;

  const blocked = pool.active < 0;
  const shown = blocked ? Math.max(0, pool.states.findIndex((s) => s.resetAt === pool.nextResetAt)) : pool.active;
  const u = pool.states[shown];
  const pct = Math.min(100, (u.used / u.limit) * 100);
  const tone = blocked ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  const text = blocked ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-neutral-400";
  const wait = (ms: number) => (ms > 0 ? formatWait(ms) : "");
  const title = pool.states
    .map((s, i) => `Key ${i + 1}${i === pool.active ? " (active)" : ""}: ${s.blocked ? `cooling down, resets in ${wait(s.resetAt - now)}` : `${s.used}/${s.limit} this minute`}`)
    .join("\n") + "\nUsage is estimated locally.";

  return (
    <>
    <div className="relative sm:hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-11 items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5">
        <Gauge size={14} className={text} />
        <span className={`text-xs tabular-nums ${text}`}>{blocked ? wait(pool.nextResetAt - now) || "0s" : `${u.used}/${u.limit}`}</span>
        <ChevronDown size={12} className={`text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-xl">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className={`h-full rounded-full ${tone}`} style={{ width: `${blocked ? 100 : pct}%` }} /></div>
          {pool.states.map((s, i) => (
            <p key={i} className="flex items-center gap-2 text-xs text-neutral-400">
              <KeyRound size={12} /> Key {i + 1}{i === pool.active ? " (active)" : ""}
              <span className={`ml-auto tabular-nums ${s.blocked ? "text-red-400" : ""}`}>{s.blocked ? `resets ${wait(s.resetAt - now)}` : `${s.used}/${s.limit}`}</span>
            </p>
          ))}
          <p className="text-[11px] text-neutral-600">Usage is estimated locally.</p>
        </div>
      )}
    </div>
    <div title={title} className="hidden items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 sm:flex">
      <Gauge size={14} className={text} />
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-800 sm:w-20">
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${blocked ? 100 : pct}%` }} />
      </div>
      <span className={`min-w-[3.25rem] text-right text-xs tabular-nums ${text}`}>
        {blocked ? `Resets ${wait(pool.nextResetAt - now)}` : `${u.used}/${u.limit}`}
      </span>
      <span className="flex items-center gap-1 border-l border-neutral-800 pl-2 text-xs text-neutral-500">
        <KeyRound size={12} />
        {blocked ? `${keys.length} keys` : `${pool.active + 1}/${keys.length}`}
        {keys.length > 1 && (
          <span className="ml-0.5 flex gap-0.5">
            {pool.states.map((s, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${s.blocked ? "bg-red-500" : i === pool.active ? "bg-emerald-400" : "bg-neutral-600"}`} />
            ))}
          </span>
        )}
      </span>
    </div>
    </>
  );
}