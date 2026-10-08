import { GoogleGenAI } from "@google/genai";
import { MODEL } from "@/lib/defaults";

export const runtime = "nodejs";

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown })?.status;
  if (typeof s === "number") return s;
  const msg = e instanceof Error ? e.message : "";
  return /"code":\s*503|UNAVAILABLE|high demand/i.test(msg) ? 503 : undefined;
};

/** Pulls a short human message out of an SDK error (which embeds the raw JSON body). */
function readable(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  try {
    const m = JSON.parse(msg) as { error?: { message?: string } };
    if (m.error?.message) return m.error.message.slice(0, 200);
  } catch { /* not JSON */ }
  return msg.slice(0, 200) || "Invalid key";
}

export async function POST(req: Request) {
  const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: string };
  if (!apiKey?.trim()) return Response.json({ ok: false, error: "Enter a key first." });
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const check = () => ai.models.generateContent({ model: MODEL, contents: "Reply with OK", config: { maxOutputTokens: 5 } });
  try {
    try {
      await check();
    } catch (e) {
      if (statusOf(e) !== 503) throw e;
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
      await check();
    }
    return Response.json({ ok: true });
  } catch (e) {
    // An overloaded model says nothing about the key itself: accept it and explain.
    if (statusOf(e) === 503) return Response.json({ ok: true, message: "Key accepted. Google's servers are under high load right now, so it couldn't be fully tested." });
    return Response.json({ ok: false, error: readable(e) });
  }
}
