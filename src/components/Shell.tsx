"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Cloud, Compass, Home, LogOut, Menu, PlusCircle, Settings, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import AuthModal from "./AuthModal";

const NAV = [
  { href: "/", label: "Library", icon: Home },
  { href: "/create", label: "Creator", icon: PlusCircle },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, ready, cloud, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [accountError, setAccountError] = useState("");

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!ready) return null;
  if (!user) return <AuthModal />;
  const playing = path.startsWith("/play");
  async function signOut() {
    setAccountError("");
    try {
      await logout();
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Could not sign out.");
    }
  }

  const links = (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-neutral-800 text-amber-400" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-100"}`}>
            <Icon size={18} /> {label}
          </Link>
        );
      })}
    </nav>
  );
  const account = (
    <div className="border-t border-neutral-800 pt-3">
      <p className="flex items-center gap-1.5 truncate px-3 pb-2 text-xs text-neutral-500">
        {cloud && <Cloud size={12} className="shrink-0 text-emerald-400" />} <span className="truncate">{user.email}</span>
      </p>
      {accountError && <p role="alert" className="px-3 pb-2 text-xs text-red-400">{accountError}</p>}
      <button onClick={signOut} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-neutral-400 hover:text-red-400"><LogOut size={18} /> Sign out</button>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-hidden md:flex-row">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900/95 px-3 backdrop-blur-md md:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold"><BookOpen className="text-amber-500" size={18} /> Story Engine</Link>
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800"><Menu size={22} /></button>
      </header>

      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-4 md:flex">
        <div className="flex items-center gap-2 px-2 pb-4 text-lg font-semibold"><BookOpen className="text-amber-500" size={20} /> Story Engine</div>
        {links}
        <div className="mt-auto">{account}</div>
      </aside>

      <div className={`fixed inset-0 z-40 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div onClick={() => setOpen(false)} className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} />
        <aside className={`absolute inset-y-0 right-0 flex w-[80vw] max-w-xs flex-col gap-4 border-l border-neutral-800 bg-neutral-900 p-4 transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}>
          <div className="flex items-center justify-between">
            <span className="px-2 font-semibold">Menu</span>
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800"><X size={20} /></button>
          </div>
          {links}
          <div className="mt-auto pb-[env(safe-area-inset-bottom)]">{account}</div>
        </aside>
      </div>

      <main className={`min-w-0 flex-1 ${playing ? "" : "mx-auto w-full max-w-6xl p-4 md:p-8"}`}>{children}</main>
    </div>
  );
}