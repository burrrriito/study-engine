"use client";
import { useState } from "react";
import { BookOpen, Cloud, UserRound } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export default function AuthModal() {
  const { login, register, guest } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "login") await login(email, pw);
      else {
        const msg = await register(email, pw);
        if (msg) { setInfo(msg); setMode("login"); }
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  const input = "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-base outline-none focus:border-amber-500 sm:py-2.5 sm:text-sm";
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <form onSubmit={submit} className="max-h-[92dvh] w-[92vw] max-w-sm space-y-4 overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="text-amber-500" size={20} /> Story Engine</div>
        <p className="flex items-start gap-2 text-sm text-neutral-400">
          {isSupabaseConfigured ? <Cloud size={16} className="mt-0.5 shrink-0 text-emerald-400" /> : null}
          {isSupabaseConfigured
            ? mode === "login" ? "Sign in to sync your stories and progress across devices." : "Create an account to sync across devices."
            : mode === "login" ? "Sign in to continue your stories." : "Create a local account. Data stays in this browser."}
        </p>
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input className={input} type="password" placeholder="Password (8+ chars)" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {err && <p className="text-sm text-red-400">{err}</p>}
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        <button disabled={busy} className="min-h-11 w-full rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50">
          {busy ? "..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); setInfo(""); }} className="min-h-11 w-full text-sm text-neutral-400 hover:text-neutral-100">
          {mode === "login" ? "No account? Register" : "Have an account? Sign in"}
        </button>
        {isSupabaseConfigured && (
          <button type="button" onClick={async () => { try { await guest(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not switch to guest mode."); } }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-neutral-800 text-sm text-neutral-300 hover:border-neutral-600">
            <UserRound size={16} /> Continue as guest (this device only)
          </button>
        )}
      </form>
    </div>
  );
}