import { GoogleGenAI } from "@google/genai";
import { MODEL } from "@/lib/defaults";
import { errorResponse } from "@/lib/gemini-error";
import { formatMemory, parseMemory } from "@/lib/memory";
import type { Memory } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { apiKey, memory, recent } = (await req.json()) as { apiKey: string; memory: Memory; recent: { role: string; content: string }[] };
  if (!apiKey) return new Response("Missing API key", { status: 400 });
  const ai = new GoogleGenAI({ apiKey });
  const transcript = recent.map((m) => `${m.role === "gm" ? "GM" : "PLAYER"}: ${m.content}`).join("\n\n");
  try {
    const r = await ai.models.generateContent({
      model: MODEL,
      contents: `Current memory:\n${formatMemory(memory)}\n\nRecent turns:\n${transcript}\n\nUpdate the memory with new facts from the recent turns. Keep concise bullet lines, keep still-valid facts, drop resolved items.
- Long-Term: major world events, milestones, permanent injuries, assets.
- Temporary: current location, time of day, combat state, conversation topic.
- Relationship: NPC trust/affection scores, romantic status, grudges, debts.
- Goal: active quests, survival needs, impending threats.
Output ONLY these four blocks in this exact format:
[Long-Term Memory]
...
[Temporary Memory]
...
[Relationship Memory]
...
[Goal Memory]
...`,
      config: { temperature: 0.2 },
    });
    return Response.json({ memory: parseMemory(r.text ?? "", memory) });
  } catch (e) {
    return errorResponse(e);
  }
}
