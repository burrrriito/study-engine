import { MODEL } from "./defaults";

/** Normalises a pasted key (trims, strips quotes). */
export const cleanKey = (key: string) => key.trim().replace(/^["']|["']$/g, "");

/** Google AI Studio (Generative Language API) only; never Vertex AI / aiplatform.googleapis.com. */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Thrown for non-2xx Gemini responses; `message` is the raw response body so error parsers can read it. */
export class GeminiHttpError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`);
    this.status = status;
  }
}

export interface GeminiRequest {
  contents: unknown;
  systemInstruction?: unknown;
  generationConfig?: Record<string, unknown>;
}

/** The key goes in the query string and no Authorization header is sent, so every key type (AIza..., AQ....) uses the same gateway. */
export function geminiUrl(apiKey: string, method: "generateContent" | "streamGenerateContent", model = MODEL): string {
  const extra = method === "streamGenerateContent" ? "&alt=sse" : "";
  return `${GEMINI_BASE_URL}/models/${model}:${method}?key=${encodeURIComponent(cleanKey(apiKey))}${extra}`;
}

async function post(url: string, body: GeminiRequest, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new GeminiHttpError(res.status, (await res.text().catch(() => "")).slice(0, 2000));
  return res;
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
const textOf = (j: GeminiChunk) => (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");

/** One-shot generation; returns the full text. */
export async function generateText(apiKey: string, body: GeminiRequest, signal?: AbortSignal): Promise<string> {
  const res = await post(geminiUrl(apiKey, "generateContent"), body, signal);
  return textOf((await res.json()) as GeminiChunk);
}

/** Streaming generation; yields text chunks. Errors surface before the first chunk (as GeminiHttpError). */
export async function streamText(apiKey: string, body: GeminiRequest, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  const res = await post(geminiUrl(apiKey, "streamGenerateContent"), body, signal);
  const reader = res.body?.getReader();
  if (!reader) throw new GeminiHttpError(502, "Empty response from Gemini");
  async function* chunks() {
    const dec = new TextDecoder();
    let buf = "";
    const parse = (line: string): string => {
      if (!line.startsWith("data:")) return "";
      try { return textOf(JSON.parse(line.slice(5).trim()) as GeminiChunk); } catch { return ""; }
    };
    for (;;) {
      const { done, value } = await reader!.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) { const t = parse(l.trim()); if (t) yield t; }
    }
    const t = parse(buf.trim());
    if (t) yield t;
  }
  return chunks();
}
