"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@/lib/types";
import { currentUser, importLocalToCloud, login as localLogin, logout as localLogout, register as localRegister } from "@/lib/storage";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { syncProfile } from "@/lib/cloud";

interface Ctx {
  user: User | null;
  ready: boolean;
  cloud: boolean;
  login: (e: string, p: string) => Promise<void>;
  register: (e: string, p: string) => Promise<string | void>;
  guest: () => Promise<void>;
  logout: () => Promise<void>;
}
const C = createContext<Ctx>(null!);
export const useAuth = () => useContext(C);

const GUEST: User = { id: "guest", email: "Guest (this device only)" };
const LS_AUTH = "story-engine:auth";

/** One-time copy of local (guest/mock) stories into a freshly signed-in cloud account. */
async function syncLocal() {
  const ids = new Set([GUEST.id, currentUser()?.id].filter(Boolean) as string[]);
  for (const id of ids) await importLocalToCloud(id);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const sb = getSupabase();

  useEffect(() => {
    if (!sb) {
      setUser(currentUser());
      setReady(true);
      return;
    }
    let live = true;
    sb.auth.getSession().then(({ data }) => {
      if (!live) return;
      const u = data.session?.user;
      setUser(u ? { id: u.id, email: u.email ?? "" } : currentUser());
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user;
      if (u) setUser({ id: u.id, email: u.email ?? "" });
      else setUser((prev) => (prev?.id === GUEST.id ? prev : null));
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  const login = useCallback(async (email: string, password: string) => {
    if (!sb) return setUser(await localLogin(email, password));
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    await syncProfile({ id: data.user.id, email: data.user.email });
    await syncLocal();
    setUser({ id: data.user.id, email: data.user.email ?? "" });
  }, [sb]);

  const register = useCallback(async (email: string, password: string) => {
    if (!sb) return void setUser(await localRegister(email, password));
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    if (!data.session || !data.user) return "Check your inbox to confirm your email, then sign in.";
    await syncProfile({ id: data.user.id, email: data.user.email });
    await syncLocal();
    setUser({ id: data.user.id, email: data.user.email ?? "" });
  }, [sb]);

  const guest = useCallback(async () => {
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw new Error(error.message);
    }
    localStorage.setItem(LS_AUTH, JSON.stringify(GUEST));
    setUser(GUEST);
  }, [sb]);

  const logout = useCallback(async () => {
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw new Error(error.message);
    }
    localLogout();
    setUser(null);
  }, [sb]);

  return <C.Provider value={{ user, ready, cloud: isSupabaseConfigured && !!user && user.id !== GUEST.id, login, register, guest, logout }}>{children}</C.Provider>;
}