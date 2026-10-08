import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };

const { fetchWithKeys, AllKeysLimitedError } = await import("./keypool.ts");
const { getPool } = await import("./usage.ts");

const calls: string[] = [];
function mockFetch(limited: string[]) {
  (globalThis as any).fetch = async (_u: string, init: { body: string }) => {
    const { apiKey } = JSON.parse(init.body);
    calls.push(apiKey);
    return limited.includes(apiKey) ? new Response("x", { status: 429, headers: { "Retry-After": "30" } }) : new Response("ok");
  };
}

test("retries with next key on 429 and cools the first down", async () => {
  mem.clear(); calls.length = 0;
  mockFetch(["AAAAAAAA1"]);
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1", "BBBBBBBB2"], 10, (apiKey) => ({ apiKey }));
  assert.equal(await res.text(), "ok");
  assert.deepEqual(calls, ["AAAAAAAA1", "BBBBBBBB2"]);
  const pool = getPool(["AAAAAAAA1", "BBBBBBBB2"], 10);
  assert.equal(pool.active, 1);
  assert.ok(pool.states[0].blocked);
});

test("skips cooling key on later requests, throws when all limited", async () => {
  calls.length = 0;
  await fetchWithKeys("/api/chat", ["AAAAAAAA1", "BBBBBBBB2"], 10, (apiKey) => ({ apiKey }));
  assert.deepEqual(calls, ["BBBBBBBB2"]);
  mockFetch(["AAAAAAAA1", "BBBBBBBB2"]);
  await assert.rejects(fetchWithKeys("/api/chat", ["AAAAAAAA1", "BBBBBBBB2"], 10, (apiKey) => ({ apiKey })), AllKeysLimitedError);
});

test("forwards to fallback when all keys are limited, sets no error", async () => {
  mem.clear(); calls.length = 0;
  const urls: string[] = [];
  (globalThis as any).fetch = async (u: string, init: { body: string }) => {
    urls.push(u);
    return u === "/api/chat" ? new Response("x", { status: 429 }) : new Response("or", { headers: { "X-Provider": "openrouter" } });
  };
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1"], 10, (apiKey) => ({ apiKey }), { fallback: { url: "/api/openrouter/chat", makeBody: () => ({}) } });
  assert.equal(res.headers.get("X-Provider"), "openrouter");
  assert.deepEqual(urls, ["/api/chat", "/api/openrouter/chat"]);
});

test("throws AllKeysLimitedError when fallback also fails or is absent", async () => {
  (globalThis as any).fetch = async () => new Response("boom", { status: 500 });
  const opts = { fallback: { url: "/api/openrouter/chat", makeBody: () => ({}) } };
  await assert.rejects(fetchWithKeys("/api/chat", ["AAAAAAAA1"], 10, (apiKey) => ({ apiKey }), opts), AllKeysLimitedError);
  await assert.rejects(fetchWithKeys("/api/chat", ["AAAAAAAA1"], 10, (apiKey) => ({ apiKey })), AllKeysLimitedError);
});

test("404 (model unavailable) skips key rotation and uses fallback", async () => {
  mem.clear();
  const urls: string[] = [];
  (globalThis as any).fetch = async (u: string) => {
    urls.push(u);
    return u === "/api/chat" ? new Response("nf", { status: 404 }) : new Response("or");
  };
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1", "BBBBBBBB2"], 10, (apiKey) => ({ apiKey }), { fallback: { url: "/api/openrouter/chat", makeBody: () => ({}) } });
  assert.equal(await res.text(), "or");
  assert.deepEqual(urls, ["/api/chat", "/api/openrouter/chat"]);
  assert.ok(!getPool(["AAAAAAAA1", "BBBBBBBB2"], 10).states[0].blocked);
});

test("404 without fallback is returned to the caller", async () => {
  (globalThis as any).fetch = async () => new Response("nf", { status: 404 });
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1"], 10, (apiKey) => ({ apiKey }));
  assert.equal(res.status, 404);
});

test("503 retries once on same key then fails over without rotating keys", async () => {
  mem.clear();
  const seen: string[] = [];
  (globalThis as any).fetch = async (u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    seen.push(u === "/api/chat" ? b.apiKey : `or:${b.model}`);
    if (u === "/api/chat") return new Response("{\"error\":{\"message\":\"high demand\"}}", { status: 503 });
    return b.model === "m1" ? new Response("bad", { status: 500 }) : new Response("or");
  };
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1", "BBBBBBBB2"], 10, (apiKey) => ({ apiKey }), {
    fallback: { url: "/api/openrouter/chat", models: ["m1", "m2"], makeBody: (model) => ({ model }) },
  });
  assert.equal(await res.text(), "or");
  assert.deepEqual(seen, ["AAAAAAAA1", "AAAAAAAA1", "or:m1", "or:m2"]);
  assert.ok(!getPool(["AAAAAAAA1", "BBBBBBBB2"], 10).states[0].blocked);
});

test("400 is returned as-is: no cooldown, no key rotation, no fallback", async () => {
  mem.clear();
  const urls: string[] = [];
  (globalThis as any).fetch = async (u: string) => { urls.push(u); return new Response("bad request body", { status: 400 }); };
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1", "BBBBBBBB2"], 10, (apiKey) => ({ apiKey }), { fallback: { url: "/api/openrouter/chat", makeBody: () => ({}) } });
  assert.equal(res.status, 400);
  assert.deepEqual(urls, ["/api/chat"]);
  assert.ok(!getPool(["AAAAAAAA1", "BBBBBBBB2"], 10).states[0].blocked);
});

test("discovers free OpenRouter models dynamically and caches them", async () => {
  const { getFreeOpenRouterModels, clearModelCache } = await import("./keypool.ts");
  clearModelCache();
  let hits = 0;
  (globalThis as any).fetch = async () => {
    hits++;
    return Response.json({ data: [
      { id: "a/paid", context_length: 9, pricing: { prompt: "0.1", completion: "0.1" } },
      { id: "b/free-small", context_length: 10, pricing: { prompt: "0", completion: "0" } },
      { id: "c/big:free", context_length: 100, pricing: { prompt: "0", completion: "0" } },
      { id: "d/image:free", context_length: 500, pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text", "audio"] } },
      { id: "e/x-content-safety:free", context_length: 900, pricing: { prompt: "0", completion: "0" } },
      { id: "openrouter/free", context_length: 5, pricing: { prompt: "0", completion: "0" } },
    ] });
  };
  assert.deepEqual(await getFreeOpenRouterModels(), ["openrouter/free", "c/big:free", "b/free-small"]);
  await getFreeOpenRouterModels();
  assert.equal(hits, 1);
});

test("fallback resolver is used for the OpenRouter chain", async () => {
  mem.clear();
  const seen: unknown[] = [];
  (globalThis as any).fetch = async (u: string, init: { body: string }) => {
    if (u === "/api/chat") return new Response("x", { status: 429 });
    const { model } = JSON.parse(init.body); seen.push(model);
    return model === "m1" ? new Response("gone", { status: 404 }) : new Response("or");
  };
  const res = await fetchWithKeys("/api/chat", ["AAAAAAAA1"], 10, (apiKey) => ({ apiKey }), { fallback: { url: "/or", models: async () => ["m1", "m2"], makeBody: (model) => ({ model }) } });
  assert.equal(await res.text(), "or");
  assert.deepEqual(seen, ["m1", "m2"]);
});

