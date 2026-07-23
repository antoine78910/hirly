import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { adminApiErrorMessage } from "../../lib/adminApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

function PlatformIcon({ platform, className = "h-4 w-4" }) {
  if (platform === "instagram") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z" />
    </svg>
  );
}

export default function AddTrackedCreatorForm({ onAdded, disabled = false }) {
  const [platform, setPlatform] = useState("tiktok");
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const trimmedHandle = handle.trim();
    if (!trimmedHandle) {
      toast.error("Enter an Instagram or TikTok handle");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/admin/creator-social/creators", {
        platform,
        handle: trimmedHandle,
        name: name.trim() || undefined,
      });
      toast.success(`Added @${data?.creator?.handle || trimmedHandle.replace(/^@/, "")}`);
      setHandle("");
      setName("");
      await onAdded?.(data?.creator);
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not add creator account"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex w-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="min-w-[140px] flex-1">
        <label
          htmlFor="creator-platform"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Platform
        </label>
        <div className="flex rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-950">
          {["tiktok", "instagram"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPlatform(item)}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                platform === item
                  ? "bg-linkedin text-white"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              <PlatformIcon platform={item} className="h-4 w-4" />
              {item === "instagram" ? "Instagram" : "TikTok"}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-[180px] flex-[1.2]">
        <label
          htmlFor="creator-handle"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Handle
        </label>
        <Input
          id="creator-handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="@username"
          disabled={disabled || submitting}
          className="bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
      </div>
      <div className="min-w-[180px] flex-1">
        <label
          htmlFor="creator-name"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          Display name
        </label>
        <Input
          id="creator-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Optional"
          disabled={disabled || submitting}
          className="bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
      </div>
      <Button type="submit" disabled={disabled || submitting} className="cursor-pointer sm:mb-0.5">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add account
      </Button>
    </form>
  );
}
