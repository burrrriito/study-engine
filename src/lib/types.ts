export type Genre = "Dark Fantasy" | "Isekai" | "Cyberpunk" | "Underworld Crime" | "Sci-Fi" | "Gothic Horror" | "Romance/Harem";
export const GENRES: Genre[] = ["Dark Fantasy", "Isekai", "Cyberpunk", "Underworld Crime", "Sci-Fi", "Gothic Horror", "Romance/Harem"];

export type StoryMode = "Basic" | "Skillful" | "Max";
export const MODES: { id: StoryMode; desc: string }[] = [
  { id: "Basic", desc: "Fast, balanced, punchy." },
  { id: "Skillful", desc: "Vivid, highly descriptive, atmospheric." },
  { id: "Max", desc: "Ultra-deep psychological immersion, high realism, strict consequence logic." },
];

export const LIMITS = {
  systemPrompt: 10000,
  exampleIn: 1000,
  exampleOut: 1000,
  prologue: 2000,
  openingScene: 2000,
  suggestion: 400,
  suggestions: 3,
  triggerHint: 100,
  gallery: 50,
  description: 2000,
  imageBytes: 5 * 1024 * 1024,
  title: 100,
};

export interface PlotExample { id: string; input: string; output: string }
export interface MediaItem { id: string; imageUrl: string; triggerHint: string }

export interface Story {
  id: string;
  ownerId: string;
  title: string;
  titleImage: string;
  description: string;
  genre: Genre;
  mode: StoryMode;
  systemPrompt: string;
  plotExamples: PlotExample[];
  prologue: string;
  openingScene: string;
  initialSuggestions: string[];
  mediaGallery: MediaItem[];
  plays: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: "player" | "gm" | "whisper";
  content: string;
  suggestions?: string[];
  imagePrompts?: string[];
  /** Out-of-band scene visual: excluded from model history and memory, never advances the plot. */
  kind?: "visual";
  createdAt: number;
}

export interface Memory { longTerm: string; temporary: string; relationships: string; goals: string }

export interface Session {
  id: string;
  storyId: string;
  ownerId: string;
  messages: ChatMessage[];
  memory: Memory;
  directorNotes: string;
  imagesEnabled: boolean;
  lastPlayed: number;
}

export interface GMConfig {
  baseSystemPrompt: string;
  temperature: number;
  topP: number;
  geminiApiKeys: string[];
  rpmLimit: number;
  openRouterApiKey?: string;
  openRouterModel: string;
  useOpenRouterFallback: boolean;
}

export interface User { id: string; email: string }

export const emptyMemory = (): Memory => ({ longTerm: "", temporary: "", relationships: "", goals: "" });
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
