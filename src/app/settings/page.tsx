"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, RotateCcw, Trash2, XCircle } from "lucide-react";
import { loadConfig, saveConfig } from "@/lib/storage";
import { DEFAULT_GM_PROMPT } from "@/lib/defaults";
import { useApiKeys } from "@/lib/useApiKeys";
import KeySyncBadge from "@/components/KeySyncBadge";
import type { GMConfig } from "@/lib/types";

const OR_PRESETS = ["meta-llama/llama-3.1-8b-instruct:free", "mistralai/mistral-7b-instruct:free", "google/gemini-2.0-flash-exp:free"];

export default function SettingsPage() {
  const [cfg, setCfg] = useState<GMConfig | null>(null);
  const sync = useApiKeys();
  const [saveErr, setSaveErr] = useState("");
  const [status, setStatus] = useState<Record<number, { s: "checking" | "ok" | "bad"; msg: string }>>({});
  const [saved, setSaved] = useState(false);
  const [orStatus, setOrStatus] = useState<{ s: "checking" | "ok" | "bad"; msg: string } | null>(null);
  const [seeded, setSeeded] = useState(false);
  // Wait for key hydration so the inputs render once with the right values (no flicker).
  useEffect(() => {
    if (seeded || sync.status === "loading") return;
    const c = loadConfig();
    setCfg({ ...c, geminiApiKeys: c.geminiApiKeys.length ? c.geminiApiKeys : [""] });
    setSeeded(true);
  }, [seeded, sync.status]);
  if (!cfg) return <div className="max-w-3xl space-y-8" aria-busy="true"><div className="h-8 w-48 animate-pulse rounded bg-neutral-900" /><div className="h-72 animate-pulse rounded-xl bg-neutral-900" /></div>;
  const set = (p: Partial<GMConfig>) => { setCfg({ ...cfg, ...p }); setSaved(false); };
  const setKey = (i: number, v: string) => {
    // Pasting "k1, k2" fans out into separate rows.
    const parts = v.split(/[,\s]+/).filter(Boolean);
    const keys = [...cfg.geminiApiKeys];
    keys.splice(i, 1, ...(parts.length ? parts : [""]));
    set({ geminiApiKeys: keys });
    setStatus({});
  };
  const clean = (c: GMConfig): GMConfig => ({ ...c, geminiApiKeys: [...new Set(c.geminiApiKeys.map((k) => k.trim()).filter(Boolean))] });

  async function validateOpenRouter() {
    setOrStatus({ s: "checking", msg: "" });
    try {
      const r = await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${(cfg!.openRouterApiKey ?? "").trim()}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setOrStatus({ s: "bad", msg: j?.error?.message || `Rejected (${r.status})` });
      setOrStatus({ s: "ok", msg: j?.data?.label ? `Valid (${j.data.label})` : "Valid" });
      saveConfig(clean(cfg!));
    } catch {
      setOrStatus({ s: "bad", msg: "Network error" });
    }
  }

  async function validate(i: number) {
    setStatus((s) => ({ ...s, [i]: { s: "checking", msg: "" } }));
    const r = await fetch("/api/validate-key", { method: "POST", body: JSON.stringify({ apiKey: cfg!.geminiApiKeys[i] }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Network error" }));
    setStatus((s) => ({ ...s, [i]: { s: r.ok ? "ok" : "bad", msg: r.ok ? "Valid" : r.error } }));
    if (r.ok) saveConfig(clean(cfg!));
  }
  const box = "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-base outline-none focus:border-amber-500 sm:py-2.5 sm:text-sm";
  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Engine Settings</h1>
      <section className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <h2 className="font-medium">Gemini API Keys</h2>
          <KeySyncBadge status={sync.status} error={sync.error} showLabel />
        </div>
        <p className="text-sm text-neutral-400">{sync.userId ? "Saved to your account so they follow you across devices." : "Stored only in this browser."} Sent with each request to this app&apos;s API route, then forwarded to Google. Add several keys: when one hits its quota (429), the next is used automatically. Keys are tried in order. You can paste a comma-separated list.</p>
        <div className="space-y-2">
          {cfg.geminiApiKeys.map((k, i) => (
            <div key={i}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="w-12 shrink-0 text-xs text-neutral-500">Key {i + 1}</span>
                <input type="password" className={box} placeholder="AIza..." value={k} onChange={(e) => setKey(i, e.target.value)} autoComplete="off" />
                <div className="flex gap-2 sm:contents">
                  <button onClick={() => validate(i)} disabled={!k.trim()} className="min-h-11 flex-1 shrink-0 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40 sm:flex-none">Validate</button>
                  {cfg.geminiApiKeys.length > 1 && <button title="Remove key" aria-label={`Remove key ${i + 1}`} onClick={() => { set({ geminiApiKeys: cfg.geminiApiKeys.filter((_, j) => j !== i) }); setStatus({}); }} className="flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 hover:text-red-400"><Trash2 size={16} /></button>}
                </div>
              </div>
              {status[i]?.s === "checking" && <p className="mt-1 flex items-center gap-2 text-xs text-neutral-400 sm:ml-14"><Loader2 size={12} className="animate-spin" /> Checking...</p>}
              {status[i]?.s === "ok" && <p className="mt-1 flex items-center gap-2 text-xs text-emerald-400 sm:ml-14"><CheckCircle2 size={12} /> {status[i].msg}</p>}
              {status[i]?.s === "bad" && <p className="mt-1 flex items-center gap-2 text-xs text-red-400 sm:ml-14"><XCircle size={12} /> {status[i].msg}</p>}
            </div>
          ))}
        </div>
        <button onClick={() => set({ geminiApiKeys: [...cfg.geminiApiKeys, ""] })} className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-amber-400"><Plus size={14} /> Add another key</button>
      </section>
      <section className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">OpenRouter Fallback (Zero-Cost)</h2>
          <button role="switch" aria-checked={cfg.useOpenRouterFallback} onClick={() => set({ useOpenRouterFallback: !cfg.useOpenRouterFallback })} className={`relative h-6 w-11 shrink-0 rounded-full transition ${cfg.useOpenRouterFallback ? "bg-emerald-500" : "bg-neutral-700"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-neutral-950 transition-all ${cfg.useOpenRouterFallback ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        </div>
        <p className="text-sm text-neutral-400">When every Gemini key is rate limited, replies switch to a free OpenRouter model automatically. {sync.userId ? "The OpenRouter key is saved to your account too." : "Stored only in this browser."}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="password" className={box} placeholder="sk-or-..." value={cfg.openRouterApiKey ?? ""} onChange={(e) => { set({ openRouterApiKey: e.target.value }); setOrStatus(null); }} autoComplete="off" />
          <button onClick={validateOpenRouter} disabled={!cfg.openRouterApiKey?.trim()} className="min-h-11 shrink-0 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40">Validate OpenRouter Key</button>
        </div>
        {orStatus?.s === "checking" && <p className="flex items-center gap-2 text-xs text-neutral-400"><Loader2 size={12} className="animate-spin" /> Checking...</p>}
        {orStatus?.s === "ok" && <p className="flex items-center gap-2 text-xs text-emerald-400"><CheckCircle2 size={12} /> {orStatus.msg}</p>}
        {orStatus?.s === "bad" && <p className="flex items-center gap-2 text-xs text-red-400"><XCircle size={12} /> {orStatus.msg}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={box} value={OR_PRESETS.includes(cfg.openRouterModel) ? cfg.openRouterModel : ""} onChange={(e) => e.target.value && set({ openRouterModel: e.target.value })}>
            {OR_PRESETS.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="">Custom...</option>
          </select>
          <input className={box} placeholder="provider/model:free" value={cfg.openRouterModel} onChange={(e) => set({ openRouterModel: e.target.value })} />
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="font-medium">Universal GM System Directive</h2>
          <button onClick={() => set({ baseSystemPrompt: DEFAULT_GM_PROMPT })} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-amber-400"><RotateCcw size={12} /> Reset to Factory Defaults</button>
        </div>
        <textarea rows={14} className={`${box} font-mono`} value={cfg.baseSystemPrompt} onChange={(e) => set({ baseSystemPrompt: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm text-neutral-400">Temperature: {cfg.temperature.toFixed(2)}
            <input type="range" min={0} max={2} step={0.05} value={cfg.temperature} onChange={(e) => set({ temperature: +e.target.value })} className="w-full accent-amber-500" /></label>
          <label className="text-sm text-neutral-400">Top P: {cfg.topP.toFixed(2)}
            <input type="range" min={0} max={1} step={0.01} value={cfg.topP} onChange={(e) => set({ topP: +e.target.value })} className="w-full accent-amber-500" /></label>
          <label className="text-sm text-neutral-400">Requests per minute limit
            <input type="number" min={1} max={1000} value={cfg.rpmLimit} onChange={(e) => set({ rpmLimit: Math.max(1, +e.target.value || 1) })} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-amber-500" />
            <span className="text-xs text-neutral-500">Free tier is about 10. Drives the usage meter.</span></label>
        </div>
      </section>
      <button onClick={async () => { const c = clean(cfg); setCfg({ ...c, geminiApiKeys: c.geminiApiKeys.length ? c.geminiApiKeys : [""] }); const r = await saveConfig(c); setSaveErr(r.ok ? "" : r.error); setSaved(true); }} className="min-h-11 w-full rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 sm:w-auto">{saved ? "Saved" : "Save settings"}</button>
      {saveErr && <p className="text-xs text-amber-400">Saved on this device, but syncing to your account failed: {saveErr}. It will retry next time you open the app.</p>}
    </div>
  );
}

