import { streamText } from "@/lib/genai-client";
import { buildContents, buildSystemInstruction, type TurnPayload } from "@/lib/prompt";
import { errorResponse } from "@/lib/gemini-error";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const p = (await req.json()) as TurnPayload;
  if (!p.apiKey) return new Response("Missing Gemini API key. Add it in Settings.", { status: 400 });
  try {
    const stream = await streamText(p.apiKey, {
      contents: buildContents(p),
      systemInstruction: { parts: [{ text: buildSystemInstruction(p) }] },
      generationConfig: { temperature: p.temperature, topP: p.topP },
    }, req.signal);
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(c) {
          try {
            for await (const chunk of stream) c.enqueue(enc.encode(chunk));
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


