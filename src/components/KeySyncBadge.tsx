import { AlertTriangle, Cloud, CloudOff, Loader2 } from "lucide-react";
import type { KeySyncStatus } from "@/lib/keyStorage";

const META: Record<KeySyncStatus, { label: string; short: string; tone: string }> = {
  loading: { label: "Checking key sync…", short: "…", tone: "text-neutral-500" },
  local: { label: "Local Only - Log in to sync across devices", short: "Local", tone: "text-neutral-400" },
  synced: { label: "Synced to Account", short: "Synced", tone: "text-emerald-400" },
  saving: { label: "Saving to account…", short: "Saving", tone: "text-neutral-400" },
  error: { label: "Account sync failed - using this device's copy", short: "Sync error", tone: "text-amber-400" },
};

export const keySyncLabel = (s: KeySyncStatus, error?: string | null) => (s === "error" && error ? `${META.error.label} (${error})` : META[s].label);

/** Fixed-size icon so status changes never shift the layout; the full text lives in the tooltip / optional label. */
export default function KeySyncBadge({ status, error, showLabel = false }: { status: KeySyncStatus; error?: string | null; showLabel?: boolean }) {
  const m = META[status];
  const Icon = status === "synced" ? Cloud : status === "error" ? AlertTriangle : status === "loading" || status === "saving" ? Loader2 : CloudOff;
  return (
    <span title={keySyncLabel(status, error)} className={`inline-flex items-center gap-1.5 text-xs ${m.tone}`}>
      <Icon size={13} className={`shrink-0 ${status === "loading" || status === "saving" ? "animate-spin" : ""}`} />
      {showLabel && <span>{m.label}</span>}
    </span>
  );
}
