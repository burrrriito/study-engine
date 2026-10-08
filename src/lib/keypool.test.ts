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
