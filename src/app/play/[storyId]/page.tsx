"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Brain, Eye, ImageIcon, EyeOff, FastForward, Loader2, Megaphone, RotateCcw, Send, Square, X, Zap } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import UsageMeter from "@/components/UsageMeter";
import { AllKeysLimitedError, fetchWithKeys } from "@/lib/keypool";
import { Lightbox, MessageBody, PromptBox } from "@/components/Chat";
import { getLatestSessionForStory, getStory, loadConfig, saveSession, saveStory } from "@/lib/storage";
import { parseTurn, parseVisual, stripForStream } from "@/lib/memory";
import { useApiKeys } from "@/lib/useApiKeys";
import { hydrateKeys } from "@/lib/keyStorage";
import { MAX_HISTORY, type TurnPayload } from "@/lib/prompt";
import { emptyMemory, uid, type ChatMessage, type Memory, type Session, type Story } from "@/lib/types";

const MEM_LABELS: [keyof Memory, string][] = [["longTerm", "Long-Term"], ["temporary", "Temporary"], ["relationships", "Relationships"], ["goals", "Goals"]];

export default function PlayPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = use(params);
  const { user } = useAuth();
  const [story, setStory] = useState<Story | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [panel, setPanel] = useState<"" | "whisper" | "memory">("");
  const [whisper, setWhisper] = useState("");
  const [busyAction, setBusyAction] = useState<string>("");
  const [provider, setProvider] = useState<string | null>(null);
  const [cfgKeys, setCfgKeys] = useState<{ keys: string[]; limit: number }>({ keys: [], limit: 10 });
  const sync = useApiKeys();
  useEffect(() => { const c = loadConfig(); setCfgKeys({ keys: c.geminiApiKeys, limit: c.rpmLimit }); }, [sync.status, sync.gemini]);
  const sessionRef = useRef<Session | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const commit = useCallback(async (s: Session) => {
    sessionRef.current = s;
    setSession(s);
    try {
      await saveSession(s);
      setLoadError("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not sync session.";
      setLoadError(`Progress is not synced: ${message}`);
    }
  }, []);

  const freshSession = useCallback((st: Story, ownerId: string): Session => ({
    id: uid(), storyId: st.id, ownerId, memory: emptyMemory(), directorNotes: "", imagesEnabled: true, lastPlayed: Date.now(),
    messages: [{ id: uid(), role: "gm", content: st.prologue, suggestions: st.initialSuggestions, createdAt: Date.now() }],
  }), []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        setLoadError("");
        const st = await getStory(storyId);
        if (!alive) return;
        setStory(st ?? null);
        if (!st) return;
        let s = await getLatestSessionForStory(storyId, user.id);
        if (!s) {
          s = freshSession(st, user.id);
          await saveStory({ ...st, plays: st.plays + 1 });
        }
        if (alive) await commit(s);
      } catch (e) {
        if (alive) {
          setStory(null);
          setLoadError(e instanceof Error ? e.message : "Could not load story data.");
        }
      }
    })();
    return () => { alive = false; };
  }, [storyId, user, commit, freshSession]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [session?.messages.length, streaming]);

  async function run(action: TurnPayload["action"]) {
    const cur = sessionRef.current;
    if (!cur || !story || streaming !== null) return;
    await hydrateKeys();
    const cfg = loadConfig();
    const orKey = cfg.openRouterApiKey?.trim() ?? "";
    const useFallback = cfg.useOpenRouterFallback && !!orKey;
    if (!cfg.geminiApiKeys.length && !useFallback) return setError("Add your Gemini API key in Settings first.");
    setError("");
    const history = cur.messages.filter((m) => m.role !== "whisper" && m.kind !== "visual").slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
    const withPlayer: Session = action.kind === "input"
      ? { ...cur, lastPlayed: Date.now(), messages: [...cur.messages, { id: uid(), role: "player", content: action.text!, createdAt: Date.now() }] }
      : cur;
    await commit(withPlayer);
    setBusyAction(action.kind);
    setStreaming("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const payload: Omit<TurnPayload, "apiKey"> = {
      baseSystemPrompt: cfg.baseSystemPrompt, temperature: cfg.temperature, topP: cfg.topP,
      story: { title: story.title, mode: story.mode, systemPrompt: story.systemPrompt, plotExamples: story.plotExamples, openingScene: story.openingScene, initialSuggestions: story.initialSuggestions, media: story.mediaGallery.map(({ id, triggerHint }) => ({ id, triggerHint })) },
      memory: cur.memory, directorNotes: cur.directorNotes, imagesEnabled: cur.imagesEnabled, history, action,
    };
    let raw = "";
    try {
      const res = await fetchWithKeys("/api/chat", cfg.geminiApiKeys, cfg.rpmLimit, (apiKey) => ({ ...payload, apiKey }), {
        signal: ctrl.signal,
        fallback: useFallback ? { url: "/api/openrouter/chat", models: [...new Set([cfg.openRouterModel, "mistralai/mistral-7b-instruct:free"])], makeBody: (model) => ({ ...payload, openRouterApiKey: orKey, openRouterModel: model ?? cfg.openRouterModel }) } : null,
      });
      setProvider(res.headers.get("X-Provider") === "openrouter" ? cfg.openRouterModel : null);
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        setStreaming(stripForStream(raw));
      }
    } catch (e) {
      if (e instanceof AllKeysLimitedError) setError(e.message);
      else if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message.slice(0, 300) : "Generation failed.");
    }
    abortRef.current = null;
    setStreaming(null);
    if (!raw.trim()) return;
    const t = parseTurn(raw);
    const gm: ChatMessage = action.kind === "visual"
      ? (() => { const v = parseVisual(raw); return { id: uid(), role: "gm" as const, kind: "visual" as const, content: v.summary, imagePrompts: [v.prompt], createdAt: Date.now() }; })()
      : { id: uid(), role: "gm", content: t.text, suggestions: t.suggestions, imagePrompts: t.imagePrompts, createdAt: Date.now() };
    const base = sessionRef.current ?? withPlayer;
    const next = { ...base, messages: [...base.messages, gm], lastPlayed: Date.now() };
    await commit(next);
    if (action.kind !== "visual") updateMemory(next);
  }

  async function updateMemory(s: Session) {
    try {
      const cfg = loadConfig();
      const recent = s.messages.filter((m) => m.role !== "whisper" && m.kind !== "visual").slice(-4).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetchWithKeys("/api/memory", cfg.geminiApiKeys, cfg.rpmLimit, (apiKey) => ({ apiKey, memory: s.memory, recent }));
      if (!res.ok) return;
      const { memory } = await res.json();
      await commit({ ...(sessionRef.current ?? s), memory });
    } catch { /* memory is best-effort */ }
  }

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    run({ kind: "input", text: t });
  }

  async function sendWhisper() {
    const cur = sessionRef.current;
    if (!cur || !whisper.trim()) return;
    await commit({ ...cur, directorNotes: (cur.directorNotes ? cur.directorNotes + "\n" : "") + "- " + whisper.trim(), messages: [...cur.messages, { id: uid(), role: "whisper", content: whisper.trim(), createdAt: Date.now() }] });
    setWhisper("");
  }

  async function restart() {
    if (!story || !user || !confirm("Restart this story? Current progress will be replaced by a new save.")) return;
    await commit(freshSession(story, user.id));
  }

  if (story === undefined || (story && !session)) return <div className="p-8 text-neutral-500">{loadError || "Loading..."}</div>;
  if (story === null || !session) return <div className="p-8">Story not found. <Link href="/" className="text-amber-400">Go home</Link></div>;

  const last = [...session.messages].reverse().find((m) => m.kind !== "visual");
  const busy = streaming !== null;
  const mem = session.memory;
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[100dvh]">
      <header className="flex min-h-14 items-center gap-1 border-b border-neutral-800 bg-neutral-900/60 px-2 py-1.5 sm:gap-2 sm:px-4">
        <h1 className="mr-auto truncate text-sm font-medium">{story.title}</h1>
        {provider && (
          <span title={`Gemini is rate limited; replies are coming from ${provider}.`} className="flex max-w-[11rem] items-center gap-1 truncate rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-400 sm:max-w-xs">
            <Zap size={12} className="shrink-0" /> <span className="truncate">OpenRouter Fallback Active ({provider})</span>
          </span>
        )}
        <UsageMeter keys={cfgKeys.keys} limit={cfgKeys.limit} syncStatus={sync.status} syncError={sync.error} />
        <button title="Toggle visual triggers" onClick={() => commit({ ...session, imagesEnabled: !session.imagesEnabled })} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${session.imagesEnabled ? "text-emerald-400" : "text-neutral-500"}`}>{session.imagesEnabled ? <Eye size={18} /> : <EyeOff size={18} />}</button>
        <button title="Memory" onClick={() => setPanel(panel === "memory" ? "" : "memory")} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${panel === "memory" ? "text-amber-400" : "text-neutral-400"}`}><Brain size={18} /></button>
        <button title="Director / GM Whisper" onClick={() => setPanel(panel === "whisper" ? "" : "whisper")} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${panel === "whisper" ? "text-red-400" : "text-neutral-400"}`}><Megaphone size={18} /></button>
        <button title="Restart" onClick={restart} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100"><RotateCcw size={18} /></button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto px-4 py-6 pb-36 md:pb-6">
          <div className="mx-auto max-w-2xl space-y-6">
            {session.messages.map((m) => m.role === "whisper" ? (
              <p key={m.id} className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">Director: {m.content}</p>
            ) : m.role === "player" ? (
              <p key={m.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-800 px-4 py-2.5 text-sm">{m.content}</p>
            ) : (
              <div key={m.id} className="text-neutral-200">
                {m.kind !== "visual" && <MessageBody text={m.content} media={story.mediaGallery} onZoom={setZoom} />}
                {(session.imagesEnabled || m.kind === "visual") && m.imagePrompts?.map((p, i) => <PromptBox key={i} prompt={p} summary={m.kind === "visual" ? m.content : undefined} />)}
              </div>
            ))}
            {streaming !== null && (
              <div className="text-neutral-200">
                {busyAction === "visual" ? <p className="flex items-center gap-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-sm text-neutral-400"><Loader2 className="animate-spin" size={14} /> Composing scene visual...</p> : streaming ? <MessageBody text={streaming} media={story.mediaGallery} onZoom={setZoom} /> : <Loader2 className="animate-spin text-neutral-500" size={18} />}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {panel && (
          <aside className="fixed inset-x-0 bottom-0 top-auto z-40 max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl md:absolute md:inset-y-0 md:left-auto md:right-0 md:top-0 md:max-h-none md:w-full md:max-w-sm md:rounded-none md:pb-4">
            <button aria-label="Close panel" onClick={() => setPanel("")} className="float-right flex h-11 w-11 items-center justify-center text-neutral-500 hover:text-neutral-100"><X size={18} /></button>
            {panel === "whisper" ? (
              <div className="space-y-3">
                <h2 className="font-medium text-red-300">Director / GM Whisper</h2>
                <p className="text-xs text-neutral-400">Out-of-character directives to the GM. They shape upcoming turns without appearing in the story.</p>
                <textarea rows={4} value={whisper} onChange={(e) => setWhisper(e.target.value)} placeholder="Make Roxy more suspicious of me..." className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-base outline-none focus:border-red-500 sm:text-sm" />
                <button onClick={sendWhisper} className="min-h-11 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-neutral-950">Send directive</button>
                {session.directorNotes && (<>
                  <pre className="whitespace-pre-wrap rounded-lg bg-neutral-950 p-2.5 text-xs text-neutral-400">{session.directorNotes}</pre>
                  <button onClick={() => commit({ ...session, directorNotes: "" })} className="text-xs text-neutral-500 hover:text-red-400">Clear all directives</button>
                </>)}
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="font-medium text-amber-400">Story Memory</h2>
                <p className="text-xs text-neutral-400">Updated automatically after each turn. Editable.</p>
                {MEM_LABELS.map(([k, label]) => (
                  <label key={k} className="block text-xs text-neutral-400">{label}
                    <textarea rows={4} value={mem[k]} onChange={(e) => commit({ ...session, memory: { ...mem, [k]: e.target.value } })} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-base text-neutral-200 outline-none focus:border-amber-500 sm:text-sm" />
                  </label>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto max-w-2xl space-y-2">
          {loadError && <p className="text-xs text-red-400">{loadError}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!busy && last?.role === "gm" && !!last.suggestions?.length && (
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
              {last.suggestions.map((s, i) => <button key={i} onClick={() => send(s)} className="min-h-11 flex-shrink-0 rounded-full border border-neutral-700 px-3 py-1.5 text-left text-xs text-neutral-300 hover:border-amber-500 hover:text-amber-400">{s}</button>)}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run({ kind: "visual" })} title="Generate Scene Visual" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-sm text-neutral-300 hover:border-amber-500 hover:text-amber-400 disabled:opacity-40 sm:w-auto sm:gap-1.5 sm:px-3"><ImageIcon size={18} /> <span className="hidden lg:inline">Scene Visual</span></button>
            <button type="button" disabled={busy} onClick={() => run({ kind: "continue" })} title="Continue Story" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-sm text-neutral-300 hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-40 sm:w-auto sm:gap-1.5 sm:px-3"><FastForward size={18} /> <span className="hidden sm:inline">Continue</span></button>
            <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} placeholder="What do you do or say?" className="min-h-11 min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-base outline-none focus:border-amber-500 sm:text-sm" />
            {busy ? (
              <button type="button" aria-label="Stop generation" onClick={() => abortRef.current?.abort()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-500 text-neutral-950"><Square size={16} /></button>
            ) : (
              <button aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 hover:bg-amber-400"><Send size={16} /></button>
            )}
          </form>
        </div>
      </footer>
      <Lightbox url={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

