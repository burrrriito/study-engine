import { buildContents, buildSystemInstruction, type TurnPayload } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = Omit<TurnPayload, "apiKey"> & { openRouterApiKey: string; openRouterModel: string };

export async function POST(req: Request) {
  const p = (await req.json()) as Body;
  if (!p.openRouterApiKey) return new Response("Missing OpenRouter API key. Add it in Settings.", { status: 400 });
  if (!p.openRouterModel) return new Response("Missing OpenRouter model.", { status: 400 });

  const turn = { ...p, apiKey: "" } as TurnPayload;
  const messages = [
    { role: "system", content: buildSystemInstruction(turn) },
    ...buildContents(turn).map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts[0].text })),
  ];

  let upstream: Response;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${p.openRouterApiKey}`,
        "HTTP-Referer": new URL(req.url).origin || "http://localhost:3000",
        "X-Title": "Story Engine",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stream: true, model: p.openRouterModel, messages, temperature: 0.85 }),
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "OpenRouter request failed", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    const headers: Record<string, string> = {};
    if (upstream.status === 429) headers["Retry-After"] = upstream.headers.get("Retry-After") || "30";
    return new Response(detail || `OpenRouter error ${upstream.status}`, { status: upstream.status || 502, headers });
  }

  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const reader = upstream.body.getReader();
  let buf = "";
  // Converts OpenAI-style SSE ("data: {...}") into plain text chunks.
  const handle = (line: string, out: ReadableStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data:")) return; // also skips ": OPENROUTER PROCESSING" comments
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      if (j.error) throw new Error(j.error.message || "OpenRouter stream error");
      const text = j.choices?.[0]?.delta?.content;
      if (text) out.enqueue(enc.encode(text));
    } catch (e) {
      if (e instanceof SyntaxError) return;
      throw e;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buf) handle(buf.trim(), c);
          return c.close();
        }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) handle(l.trim(), c);
      } catch (e) {
        c.error(e);
      }
    },
    cancel: () => reader.cancel(),
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Provider": "openrouter" } });
}