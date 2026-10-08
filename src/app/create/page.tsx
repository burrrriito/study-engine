"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { saveStory, storeStoryImage } from "@/lib/storage";
import { GENRES, LIMITS, MODES, uid, type Genre, type MediaItem, type PlotExample, type Story, type StoryMode } from "@/lib/types";

const TABS = ["Profile", "Basic Settings", "Intro", "Media", "Publish"];
const box = "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-base outline-none focus:border-amber-500 sm:py-2.5 sm:text-sm";

function Counter({ v, max }: { v: string; max: number }) {
  return <span className={`text-xs ${v.length > max ? "text-red-400" : "text-neutral-500"}`}>{v.length}/{max}</span>;
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-neutral-200">{label}</span>
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      {children}
    </label>
  );
}
function Area({ value, max, onChange, rows = 4, placeholder }: { value: string; max: number; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <div>
      <textarea className={box} rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <div className="text-right"><Counter v={value} max={max} /></div>
    </div>
  );
}

export default function CreatePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [storyId] = useState(() => uid());
  const [title, setTitle] = useState("");
  const [titleImage, setTitleImage] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [examples, setExamples] = useState<PlotExample[]>([]);
  const [prologue, setPrologue] = useState("");
  const [openingScene, setOpeningScene] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState<Genre>("Dark Fantasy");
  const [mode, setMode] = useState<StoryMode>("Skillful");
  const coverRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined, cb: (data: string) => void) {
    if (!file) return;
    try { setErr(""); cb(await storeStoryImage(file, LIMITS.imageBytes, storyId)); } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
  }

  function validate(): string {
    if (!title.trim()) return "Story name is required.";
    if (!systemPrompt.trim()) return "Story-AI Prompt is required.";
    if (!prologue.trim()) return "Prologue is required.";
    if (!description.trim()) return "Description is required.";
    if (media.some((m) => !m.triggerHint.trim())) return "Every scene image needs a Scene Instruction.";
    return "";
  }

  async function publish() {
    const v = validate();
    if (v) return setErr(v);
    if (!user) return;
    const now = Date.now();
    const story: Story = {
      id: storyId, ownerId: user.id, title: title.trim(), titleImage, description: description.trim(), genre, mode,
      systemPrompt, plotExamples: examples.filter((e) => e.input.trim() || e.output.trim()), prologue, openingScene,
      initialSuggestions: suggestions.map((s) => s.trim()).filter(Boolean), mediaGallery: media, plays: 0, createdAt: now, updatedAt: now,
    };
    setSaving(true);
    try { await saveStory(story); router.push("/"); } catch (e) { setErr(e instanceof Error && e.message ? `Could not save: ${e.message}` : "Could not save (browser storage may be full)."); } finally { setSaving(false); }
  }

  const btn = "min-h-11 rounded-lg border border-neutral-800 px-4 py-2 text-sm sm:min-h-0 sm:px-3 text-neutral-300 hover:border-neutral-600";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Create Story</h1>
      <div className="-mx-4 flex flex-nowrap gap-2 overflow-x-auto scrollbar-none px-4 pb-1 md:mx-0 md:px-0">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`min-h-10 flex-shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm ${tab === i ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-neutral-800 text-neutral-400 hover:text-neutral-100"}`}>{i + 1}. {t}</button>
        ))}
      </div>

      <div className="space-y-5">
        {tab === 0 && (<>
          <Field label="Title Image" hint="Up to 5MB.">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
              <div onClick={() => coverRef.current?.click()} role="button" className="flex h-44 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-700 bg-neutral-900 text-neutral-600 active:border-amber-500 md:h-28 md:w-48">
                {titleImage ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={titleImage} alt="" className="h-full w-full object-cover" /> : <ImagePlus />}
              </div>
              <input ref={coverRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0], setTitleImage); e.target.value = ""; }} />
              <div className="flex gap-2 md:flex-col">
                <button type="button" className={`${btn} flex-1`} onClick={() => coverRef.current?.click()}>Upload</button>
                {titleImage && <button type="button" className={`${btn} flex-1`} onClick={() => setTitleImage("")}>Remove</button>}
              </div>
            </div>
          </Field>
          <Field label="Story Name">
            <input className={box} maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Lower Docks" />
          </Field>
        </>)}

        {tab === 1 && (<>
          <Field label="Story-AI Prompt" hint="World lore, faction rules, content allowances, tone, mechanics.">
            <Area value={systemPrompt} max={LIMITS.systemPrompt} rows={14} onChange={setSystemPrompt} />
          </Field>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Plot Examples</span>
              <button type="button" className={btn} onClick={() => setExamples([...examples, { id: uid(), input: "", output: "" }])}><Plus size={14} className="inline" /> Add Example</button></div>
            {examples.map((ex, i) => (
              <div key={ex.id} className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex justify-between text-xs text-neutral-500">Example {i + 1}
                  <button type="button" onClick={() => setExamples(examples.filter((e) => e.id !== ex.id))} className="hover:text-red-400"><Trash2 size={14} /></button></div>
                <Field label="User Input Example"><Area value={ex.input} max={LIMITS.exampleIn} rows={3} onChange={(v) => setExamples(examples.map((e) => (e.id === ex.id ? { ...e, input: v } : e)))} /></Field>
                <Field label="AI Story Output Example"><Area value={ex.output} max={LIMITS.exampleOut} rows={5} onChange={(v) => setExamples(examples.map((e) => (e.id === ex.id ? { ...e, output: v } : e)))} /></Field>
              </div>
            ))}
          </div>
        </>)}

        {tab === 2 && (<>
          <Field label="Prologue" hint="Shown as the opening message in chat."><Area value={prologue} max={LIMITS.prologue} rows={8} onChange={setPrologue} /></Field>
          <Field label="Opening Scene (GM only)" hint="Hidden backstory, stakes, NPC motives. Never shown to the player."><Area value={openingScene} max={LIMITS.openingScene} rows={8} onChange={setOpeningScene} /></Field>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Response Suggestions ({suggestions.length}/{LIMITS.suggestions})</span>
              {suggestions.length < LIMITS.suggestions && <button type="button" className={btn} onClick={() => setSuggestions([...suggestions, ""])}><Plus size={14} className="inline" /> Add</button>}</div>
            {suggestions.map((s, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex-1"><Area value={s} max={LIMITS.suggestion} rows={2} onChange={(v) => setSuggestions(suggestions.map((x, j) => (j === i ? v : x)))} /></div>
                <button type="button" onClick={() => setSuggestions(suggestions.filter((_, j) => j !== i))} className="h-fit p-2 text-neutral-500 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </>)}

        {tab === 3 && (<>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Scene Images ({media.length}/{LIMITS.gallery})</span>
            <input ref={mediaRef} type="file" accept="image/*" multiple hidden onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).slice(0, LIMITS.gallery - media.length);
              e.target.value = "";
              const added: MediaItem[] = [];
              for (const f of files) await pick(f, (d) => added.push({ id: uid(), imageUrl: d, triggerHint: "" }));
              setMedia((m) => [...m, ...added]);
            }} />
            <button type="button" disabled={media.length >= LIMITS.gallery} className={`${btn} w-full disabled:opacity-40 sm:w-auto`} onClick={() => mediaRef.current?.click()}><Plus size={14} className="inline" /> Add Images</button>
          </div>
          <p className="text-xs text-neutral-500">The AI places the image inline with <code>[Image: id]</code> when the scene instruction matches.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {media.map((m) => (
              <div key={m.id} className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.imageUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
                <input className={box} maxLength={LIMITS.triggerHint} placeholder="Scene instruction (e.g. First meeting at the Lower Docks)" value={m.triggerHint} onChange={(e) => setMedia(media.map((x) => (x.id === m.id ? { ...x, triggerHint: e.target.value } : x)))} />
                <div className="flex items-center justify-between gap-2"><Counter v={m.triggerHint} max={LIMITS.triggerHint} /><span className="truncate text-xs text-neutral-600">id: {m.id.slice(0, 8)}</span>
                  <button type="button" aria-label="Remove image" onClick={() => setMedia(media.filter((x) => x.id !== m.id))} className="flex h-11 w-11 items-center justify-center text-neutral-500 hover:text-red-400 sm:h-auto sm:w-auto"><Trash2 size={14} /></button></div>
              </div>
            ))}
          </div>
        </>)}

        {tab === 4 && (<>
          <Field label="Story Description" hint="Shown on the library card, not in chat."><Area value={description} max={LIMITS.description} rows={6} onChange={setDescription} /></Field>
          <Field label="Genre">
            <div className="flex flex-wrap gap-2">{GENRES.map((g) => (
              <button type="button" key={g} onClick={() => setGenre(g)} className={`min-h-10 rounded-full border px-3 py-1 text-xs ${genre === g ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-neutral-800 text-neutral-400"}`}>{g}</button>))}</div>
          </Field>
          <Field label="Recommended Mode">
            <div className="grid gap-2 sm:grid-cols-3">{MODES.map((m) => (
              <button type="button" key={m.id} onClick={() => setMode(m.id)} className={`rounded-xl border p-3 text-left ${mode === m.id ? "border-emerald-500 bg-emerald-500/10" : "border-neutral-800"}`}>
                <div className="text-sm font-medium">{m.id}</div><div className="text-xs text-neutral-400">{m.desc}</div></button>))}</div>
          </Field>
          <button type="button" onClick={publish} className="min-h-11 w-full rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold sm:w-auto text-neutral-950 hover:bg-amber-400" disabled={saving}>{saving ? "Publishing..." : "Publish Story"}</button>
        </>)}
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex justify-between pb-6">
        <button type="button" disabled={tab === 0} onClick={() => setTab(tab - 1)} className={`${btn} disabled:opacity-30`}>Back</button>
        {tab < 4 && <button type="button" onClick={() => setTab(tab + 1)} className={btn}>Next</button>}
      </div>
    </div>
  );
}
