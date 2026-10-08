import { GeminiHttpError, cleanKey, generateText } from "@/lib/genai-client";

export const runtime = "nodejs";

/** Pulls the human-readable message out of Google's JSON error body. */
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
  const key = cleanKey(apiKey);
  const check = () => generateText(key, { contents: [{ role: "user", parts: [{ text: "Reply with OK" }] }], generationConfig: { maxOutputTokens: 5 } });
  try {
    try {
      await check();
    } catch (e) {
      if (!(e instanceof GeminiHttpError) || e.status !== 503) throw e;
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
      await check();
    }
    return Response.json({ ok: true });
  } catch (e) {
    const status = e instanceof GeminiHttpError ? e.status : undefined;
    console.error("Gemini key validation error:", status, e instanceof Error ? e.message.slice(0, 500) : e);
    // An overloaded model says nothing about the key itself: accept it and explain.
    if (status === 503) return Response.json({ ok: true, message: "Key accepted. Google's servers are under high load right now, so it couldn't be fully tested." });
    if (status === 429) return Response.json({ ok: true, message: "Key accepted, but its quota is currently exhausted." });
    return Response.json({ ok: false, error: readable(e) });
  }
}
