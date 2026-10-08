import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemory, parseTurn, splitSegments } from "./memory.ts";

const prev = { longTerm: "a", temporary: "b", relationships: "c", goals: "d" };

test("parseMemory updates present buckets and keeps others", () => {
  const m = parseMemory("[Long-Term Memory]\nX\n\n[Goal Memory]\n(empty)", prev);
  assert.deepEqual(m, { longTerm: "X", temporary: "b", relationships: "c", goals: "" });
});

test("parseTurn extracts choices, image prompts and ids", () => {
  const t = parseTurn("Hi.\n[Image: img1]\nBye.\n[ImagePrompt: a dock at night]\n[Choices]\n1. One\n2. Two\n- Three\n[/Choices]");
  assert.equal(t.suggestions.length, 3);
  assert.deepEqual(t.imageIds, ["img1"]);
  assert.deepEqual(t.imagePrompts, ["a dock at night"]);
  assert.ok(!t.text.includes("Choices"));
});

test("splitSegments", () => {
  assert.equal(splitSegments("a [Image: x] b").length, 3);
});
