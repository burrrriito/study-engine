"use client";
import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import type { ChatMessage, MediaItem } from "@/lib/types";
import { parseTurn, splitSegments } from "@/lib/memory";

/** Renders **action** spans in muted italic; spans may cross line breaks, and an unclosed ** (mid-stream) stays styled. */
function renderLines(text: string, keyPrefix: string) {
  let inAction = false;
  return text.split("\n").flatMap((line, j) => {
    const parts = line.split("**");
    const nodes = parts.map((part, k) => {
      if (k > 0) inAction = !inAction;
      if (!part) return null;
      return inAction ? <span key={k} className="italic text-neutral-400">{part}</span> : <span key={k}>{part}</span>;
    });
    return line.trim() ? [<p key={`${keyPrefix}-${j}`}>{nodes}</p>] : [];
  });
}

export function MessageBody({ text, media, onZoom }: { text: string; media: MediaItem[]; onZoom: (url: string) => void }) {
  return (
    <div className="prose-story text-neutral-100">
      {splitSegments(text).map((seg, i) => {
        if (seg.type === "text") return renderLines(seg.value, String(i));
        const m = media.find((x) => x.id === seg.id);
        // eslint-disable-next-line @next/next/no-img-element
        return m ? <img key={i} src={m.imageUrl} alt={m.triggerHint} onClick={() => onZoom(m.imageUrl)} className="my-3 max-h-96 w-full cursor-zoom-in rounded-xl border border-neutral-800 object-cover" /> : null;
      })}
    </div>
  );
}

export function PromptBox({ prompt, summary }: { prompt: string; summary?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="my-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p className="mb-2 text-xs uppercase tracking-wider text-amber-400">Visual moment</p>
      <p className="text-neutral-300">{summary || prompt}</p>
      <button onClick={() => { navigator.clipboard.writeText(prompt); setOk(true); setTimeout(() => setOk(false), 1500); }} className="mt-2 flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:border-amber-500">
        {ok ? <Check size={12} /> : <Copy size={12} />} Copy DALL-E / Imagen Prompt
      </button>
    </div>
  );
}

export function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <button className="absolute right-4 top-4 text-neutral-300"><X /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg" />
    </div>
  );
}

export function renderText(m: ChatMessage) {
  return parseTurn(m.content).text;
}
