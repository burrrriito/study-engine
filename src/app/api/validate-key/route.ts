import { GoogleGenAI } from "@google/genai";
import { MODEL } from "@/lib/defaults";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { apiKey } = (await req.json()) as { apiKey: string };
  if (!apiKey?.trim()) return Response.json({ ok: false, error: "Enter a key first." });
  try {
    await new GoogleGenAI({ apiKey: apiKey.trim() }).models.generateContent({ model: MODEL, contents: "Reply with OK", config: { maxOutputTokens: 5 } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Invalid key" });
  }
}
