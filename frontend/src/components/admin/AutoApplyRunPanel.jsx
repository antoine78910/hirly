import { Loader2, Terminal, X } from "lucide-react";
import AutoApplyRunConsole from "./AutoApplyRunConsole";

export default function AutoApplyRunPanel({
  open,
  onClose,
  running,
  runLabel,
  report,
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close run console backdrop"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-violet-400" />
            <div>
              <p className="font-display text-sm font-bold text-white">Auto-apply console</p>
              <p className="text-xs text-zinc-400">
                {running ? "Running pipeline…" : report ? "Run finished" : "Waiting for result"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
            aria-label="Close console"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {running ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
              <p className="font-display text-base font-semibold text-white">{runLabel || "Running auto-apply…"}</p>
              <p className="max-w-sm text-sm text-zinc-400">
                Inspect → classify → resolve → plan → browser fill → submit → verify.
                Logs appear here when the run completes.
              </p>
            </div>
          ) : report ? (
            <AutoApplyRunConsole report={report} embedded />
          ) : (
            <p className="text-sm text-zinc-400">No run data yet.</p>
          )}
        </div>
      </aside>
    </>
  );
}
