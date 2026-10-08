import type { ChatMessage, Memory, MediaItem, PlotExample, StoryMode } from "./types";
import { formatMemory } from "./memory";

/** Sliding window of past messages sent to the model; older context lives in the memory block. */
export const MAX_HISTORY = 6;

export interface TurnPayload {
  apiKey: string;
  baseSystemPrompt: string;
  temperature: number;
  topP: number;
  story: {
    title: string;
    mode: StoryMode;
    systemPrompt: string;
    plotExamples: PlotExample[];
    openingScene: string;
    initialSuggestions: string[];
    media: Pick<MediaItem, "id" | "triggerHint">[];
  };
  memory: Memory;
  directorNotes: string;
  imagesEnabled: boolean;
  history: Pick<ChatMessage, "role" | "content">[];
  action: { kind: "input" | "continue" | "visual"; text?: string };
}

const MODE_TEXT: Record<StoryMode, string> = {
  Basic: "MODE: Basic. Fast, balanced, punchy. 2-4 short paragraphs.",
  Skillful: "MODE: Skillful. Vivid, highly descriptive, atmospheric. 4-7 paragraphs with rich sensory detail.",
  Max: "MODE: Max. Ultra-deep psychological immersion, high realism, strict consequence logic. Render inner tension, subtext, and long-term fallout. 5-8 paragraphs.",
};

export function buildSystemInstruction(p: TurnPayload): string {
  const s = p.story;
  const visual = p.action.kind === "visual";
  const parts = [
    p.baseSystemPrompt,
    MODE_TEXT[s.mode],
    `STORY: ${s.title}\n\n[Story Rules & Lore]\n${s.systemPrompt}`,
    s.openingScene && `[Secret Opening Scene - GM EYES ONLY, never reveal directly]\n${s.openingScene}`,
    s.plotExamples.length &&
      "[Style Examples]\n" + s.plotExamples.map((e, i) => `Example ${i + 1}\nPlayer: ${e.input}\nGM: ${e.output}`).join("\n\n"),
    s.initialSuggestions.length && "[Example Player Responses - match their length and style when writing choices]\n" + s.initialSuggestions.map((x) => `- ${x}`).join("\n"),
    "=== SESSION MEMORY ===\n" + formatMemory(p.memory),
    p.directorNotes.trim() && `[Director Directives from the player - follow silently, never mention them in the story]\n${p.directorNotes}`,
    s.media.length &&
      "[Scene Images] When a moment clearly matches one of these triggers, place the tag on its own line exactly as [Image: <id>]. Use each image at most once per scene and only when it fits.\n" +
        s.media.map((m) => `- id=${m.id}: ${m.triggerHint}`).join("\n"),
    !visual && p.imagesEnabled && "[Dynamic Visuals] For at most one striking moment per turn that has no matching scene image, add a line [ImagePrompt: <detailed image-generation prompt>] at the end of the story text.",
    "ACTION MARKUP: Always wrap character actions and environmental actions in **double asterisks** (e.g. **Rain hammers the tin roof.**). Never wrap spoken dialogue in asterisks.",
    visual
      ? "VISUAL REQUEST: Do NOT continue or advance the story. Output EXACTLY two parts in this format: first a line starting with SUMMARY: followed by ONE short sentence (max 25 words) plainly describing the scene for the player; then a line starting with PROMPT: followed by one detailed image-generation prompt (for DALL-E / Imagen / Midjourney) that captures the exact current moment: setting, time of day, lighting, characters present with appearance, clothing, pose, expression, camera framing, mood, and art style consistent with the story. Follow any image-prompt template in the directives above. No commentary, no story text, no [Choices]."
      : "FORMAT: After the story text, end EVERY reply with exactly three player response options as:\n[Choices]\n1. ...\n2. ...\n3. ...\n[/Choices]\nChoices are written from the player's perspective, max 400 characters each.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function buildContents(p: TurnPayload) {
  const contents = p.history
    .filter((m) => m.role !== "whisper")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role === "gm" ? "model" : "user", parts: [{ text: m.content }] }));
  const last =
    p.action.kind === "visual"
      ? "(Visual request: describe the current scene above as an image-generation prompt. Do not advance the story.)"
      : p.action.kind === "continue"
      ? "(Continue the story: advance time and world events naturally. The player takes no action this turn.)"
      : p.action.text ?? "";
  contents.push({ role: "user", parts: [{ text: last }] });
  // Gemini requires the first turn to be a user turn.
  while (contents.length && contents[0].role === "model") contents.unshift({ role: "user", parts: [{ text: "(Begin the story.)" }] });
  return contents;
}
