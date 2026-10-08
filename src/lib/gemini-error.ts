/** The SDK embeds the raw JSON body in the message; show just the human-readable part. */
function readableMessage(msg: string): string {
  try {
    const j = JSON.parse(msg) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message.slice(0, 300);
  } catch { /* plain text */ }
  return msg.slice(0, 300);
}

/**
 * Turn a Gemini SDK error into an HTTP response the client can act on:
 * 429 (+ Retry-After) triggers key rotation, 404 (model unavailable) skips straight to the fallback.
 */
export function errorResponse(e: unknown): Response {
  const msg = e instanceof Error ? e.message : "Generation failed";
  const status = (e as { status?: number })?.status;
  console.error(`[gemini] error status=${status ?? "n/a"}: ${msg.slice(0, 500)}`);
  if (status === 429 || /RESOURCE_EXHAUSTED|"code":\s*429/.test(msg)) {
    const m = msg.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i) ?? msg.match(/retry in (\d+(?:\.\d+)?)s/i);
    const wait = m ? Math.ceil(parseFloat(m[1])) : 60;
    return new Response("Gemini usage limit reached.", { status: 429, headers: { "Retry-After": String(wait) } });
  }
  if (status === 404 || /NOT_FOUND|"code":\s*404/.test(msg)) {
    return new Response(`Gemini model not found or unavailable. ${msg.slice(0, 200)}`, { status: 404 });
  }
  if (status === 503 || /UNAVAILABLE|"code":\s*503|high demand/i.test(msg)) {
    return new Response(`Gemini is under high demand (503). ${msg.slice(0, 200)}`, { status: 503 });
  }
  return new Response(readableMessage(msg), { status: status && status >= 400 && status < 600 ? status : 500 });
}

