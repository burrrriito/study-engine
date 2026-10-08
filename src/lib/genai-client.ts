import { GoogleGenAI } from "@google/genai";

/** Google Cloud / Vertex AI express-mode keys start with "AQ."; AI Studio keys start with "AIza". */
export const isVertexKey = (key: string) => key.startsWith("AQ.");

/** Normalises a pasted key (trims, strips quotes). */
export const cleanKey = (key: string) => key.trim().replace(/^["']|["']$/g, "");

/** Builds a client that talks to the right endpoint for the key type. */
export function makeGenAI(rawKey: string): GoogleGenAI {
  const apiKey = cleanKey(rawKey);
  return isVertexKey(apiKey) ? new GoogleGenAI({ vertexai: true, apiKey }) : new GoogleGenAI({ apiKey });
}
