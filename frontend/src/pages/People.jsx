import { Users, Sparkles } from "lucide-react";

export default function People() {
  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white pb-28">
      <header className="px-5 pt-6 max-w-md mx-auto">
        <h1 className="font-display font-black text-3xl tracking-tighter">People</h1>
        <p className="text-sm text-sprout-muted mt-1">Hiring managers, recruiters, and warm intros.</p>
      </header>
      <div className="max-w-md mx-auto px-5 mt-16 text-center" data-testid="people-empty">
        <div className="w-16 h-16 rounded-2xl bg-sprout-mint-soft grid place-items-center mx-auto">
          <Users className="w-7 h-7 text-sprout-mint" />
        </div>
        <h3 className="mt-5 font-display font-bold text-2xl">Coming soon</h3>
        <p className="mt-2 text-sprout-muted text-sm max-w-xs mx-auto">
          We'll surface the hiring team for every job you apply to, with one-tap warm intros via your network.
        </p>
        <span className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sprout-mint-soft text-sprout-mint text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" /> Notify me when ready
        </span>
      </div>
    </div>
  );
}
