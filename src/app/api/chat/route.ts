import { GoogleGenAI } from "@google/genai";
import { buildContents, buildSystemInstruction, type TurnPayload } from "@/lib/prompt";
import { MODEL } from "@/lib/defaults";
import { errorResponse } from "@/lib/gemini-error";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const p = (await req.json()) as TurnPayload;
  if (!p.apiKey) return new Response("Missing Gemini API key. Add it in Settings.", { status: 400 });
  const ai = new GoogleGenAI({ apiKey: p.apiKey });
  try {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: buildContents(p),
      config: { systemInstruction: buildSystemInstruction(p), temperature: p.temperature, topP: p.topP },
    });
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(c) {
          try {
            for await (const chunk of stream) if (chunk.text) c.enqueue(enc.encode(chunk.text));
            c.close();
          } catch (e) {
            c.error(e);
          }
        },
      }),
      { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
