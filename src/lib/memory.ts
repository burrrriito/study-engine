import type { Memory } from "./types";

const TAG: Record<keyof Memory, string> = {
  longTerm: "Long-Term Memory",
  temporary: "Temporary Memory",
  relationships: "Relationship Memory",
  goals: "Goal Memory",
};

export function formatMemory(m: Memory): string {
  return (Object.keys(TAG) as (keyof Memory)[]).map((k) => `[${TAG[k]}]\n${m[k].trim() || "(empty)"}`).join("\n\n");
}

/** Parse a memory block ("[Long-Term Memory] ... [Goal Memory] ...") into buckets. Missing buckets fall back to `prev`. */
export function parseMemory(text: string, prev: Memory): Memory {
  const out = { ...prev };
  const cleaned = text.replace(/```(?:json|text)?/g, "");
  const re = /\[(Long-Term Memory|Temporary Memory|Relationship Memory|Goal Memory)\]\s*([\s\S]*?)(?=\n?\s*\[(?:Long-Term Memory|Temporary Memory|Relationship Memory|Goal Memory)\]|$)/gi;
  const rev = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v.toLowerCase(), k])) as Record<string, keyof Memory>;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const key = rev[m[1].toLowerCase()];
    const val = m[2].trim();
    if (key) out[key] = /^\(empty\)$/i.test(val) ? "" : val;
  }
  return out;
}

export interface ParsedTurn { text: string; suggestions: string[]; imageIds: string[]; imagePrompts: string[] }

/** Split raw GM output into story text and trailing structured tags. */
export function parseVisual(raw: string): { summary: string; prompt: string } {
  const clean = raw.replace(/```[a-z-]*\n?/gi, "").trim();
  const m = clean.match(/^\s*SUMMARY:\s*([\s\S]*?)\n\s*PROMPT:\s*([\s\S]*)$/i);
  if (m) return { summary: m[1].trim(), prompt: m[2].trim() };
  const prompt = clean.replace(/^\s*PROMPT:\s*/i, "");
  const first = prompt.split(/(?<=[.!?])\s/)[0] ?? prompt;
  return { summary: first.length > 160 ? first.slice(0, 157) + "..." : first, prompt };
}

export function parseTurn(raw: string): ParsedTurn {
  let text = raw;
  const suggestions: string[] = [];
  const imagePrompts: string[] = [];
  text = text.replace(/\[Choices?\]\s*([\s\S]*?)(?=\[\/Choices?\]|$)(?:\[\/Choices?\])?/gi, (_, body: string) => {
    for (const line of body.split("\n")) {
      const l = line.replace(/^\s*(?:[-*\d.)]+\s*)/, "").trim();
      if (l) suggestions.push(l);
    }
    return "";
  });
  text = text.replace(/\[ImagePrompt:\s*([^\]]+)\]/gi, (_, p: string) => { imagePrompts.push(p.trim()); return ""; });
  const imageIds = [...text.matchAll(/\[Image:\s*([^\]\s]+)\s*\]/gi)].map((m) => m[1]);
  return { text: text.trim(), suggestions: suggestions.slice(0, 3), imageIds, imagePrompts };
}

/** For streaming display: hide a partially-streamed trailing choices/imageprompt block. */
export function stripForStream(raw: string): string {
  return raw.replace(/\[Choices?\][\s\S]*$/i, "").replace(/\[ImagePrompt:[^\]]*\]?/gi, "").replace(/\[(?:C|Ch|Cho|Choi|Choic|Choice|ImagePrompt?)$/i, "");
}

export type Segment = { type: "text"; value: string } | { type: "image"; id: string };
export function splitSegments(text: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[Image:\s*([^\]\s]+)\s*\]/gi)) {
    if (m.index! > last) segs.push({ type: "text", value: text.slice(last, m.index) });
    segs.push({ type: "image", id: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) segs.push({ type: "text", value: text.slice(last) });
  return segs;
}
