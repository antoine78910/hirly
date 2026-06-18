import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageSquare, Flame, Trophy, Target, Sparkles, ChevronRight, Play,
  Loader2, X, Send, CheckCircle2, ArrowRight,
} from "lucide-react";
import { api } from "../lib/api";
import { Textarea } from "../components/ui/textarea";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";

const CAT_COLORS = {
  Behavioral: "bg-violet-500/15 text-violet-300",
  Technical: "bg-blue-500/15 text-blue-300",
  "System Design": "bg-fuchsia-500/15 text-fuchsia-300",
  "Role-fit": "bg-emerald-500/15 text-emerald-300",
};

function StatCard({ icon: Icon, label, value, testid }) {
  return (
    <div className="flex-1 rounded-2xl bg-sprout-surface border border-sprout-border p-4" data-testid={testid}>
      <div className="flex items-center gap-2 text-sprout-muted text-xs uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="mt-2 font-display font-black text-3xl text-white">{value}</p>
    </div>
  );
}

function QuestionPill({ q }) {
  const color = CAT_COLORS[q.category] || "bg-sprout-mint-soft text-sprout-mint";
  return (
    <div className="p-4 rounded-2xl border border-sprout-border bg-sprout-surface" data-testid="likely-question">
      <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${color}`}>
        {q.category}
      </span>
      <p className="mt-3 text-white font-semibold leading-snug">{q.q}</p>
      {q.why && <p className="mt-2 text-sm text-sprout-muted">{q.why}</p>}
    </div>
  );
}

/* ----------------- Mock interview flow ----------------- */
function MockInterview({ open, questions, onClose, onFinished }) {
  const [step, setStep] = useState(0); // 0..n-1 question; n = scoring; n+1 = result
  const [answers, setAnswers] = useState([]);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState(null);
  const [scoring, setScoring] = useState(false);

  useEffect(() => {
    if (open) { setStep(0); setAnswers([]); setDraft(""); setResult(null); setScoring(false); }
  }, [open]);

  if (!open) return null;
  const n = questions.length;
  const onResult = !!result;

  const next = async () => {
    const ans = draft.trim();
    const merged = [...answers, ans];
    setAnswers(merged);
    setDraft("");
    if (step + 1 < n) {
      setStep(step + 1);
      return;
    }
    setScoring(true);
    try {
      const { data } = await api.post("/coach/interview/score", { questions, answers: merged });
      setResult(data);
      onFinished?.(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not score interview");
      onClose();
    } finally {
      setScoring(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="sprout fixed inset-0 z-[80] bg-sprout-bg text-white flex flex-col"
        data-testid="mock-interview-sheet"
      >
        <header className="px-5 pt-6 pb-3 flex items-center gap-3 border-b border-sprout-border">
          <button onClick={onClose} className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface" data-testid="mock-close-btn" aria-label="Close">
            <X className="w-5 h-5 text-white" />
          </button>
          <h2 className="font-display font-bold text-xl flex-1">
            {onResult ? "Your feedback" : scoring ? "Scoring…" : `Question ${step + 1} of ${n}`}
          </h2>
        </header>

        {!onResult && !scoring && (
          <div className="flex-1 overflow-y-auto px-5 pb-44 pt-5 max-w-md mx-auto w-full">
            {/* Progress */}
            <div className="flex gap-1.5 mb-6">
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className={`flex-1 h-1.5 rounded-full ${i <= step ? "bg-sprout-mint" : "bg-sprout-surface-2"}`} />
              ))}
            </div>
            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-sprout-mint">Interviewer</p>
            <h3 className="mt-2 font-display font-black text-3xl leading-tight tracking-tight" data-testid="mock-question">{questions[step]}</h3>
            <Textarea
              rows={8}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Take a breath. Speak in bullets. Keep it concrete."
              className="mt-6 rounded-2xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim text-base"
              data-testid="mock-answer-input"
            />
            <p className="mt-2 text-xs text-sprout-dim">{draft.trim().split(/\s+/).filter(Boolean).length} words</p>
          </div>
        )}

        {scoring && (
          <div className="flex-1 grid place-items-center px-6 text-center">
            <div>
              <Loader2 className="w-8 h-8 animate-spin text-sprout-mint mx-auto" />
              <p className="mt-4 text-sprout-muted">Reviewing your answers…</p>
            </div>
          </div>
        )}

        {onResult && (
          <div className="flex-1 overflow-y-auto px-5 pb-44 pt-5 max-w-md mx-auto w-full" data-testid="mock-result">
            <div className="rounded-3xl p-6 bg-swiipr-gradient text-white">
              <p className="text-xs uppercase tracking-widest text-white/80">Overall</p>
              <p className="font-display font-black text-6xl mt-1" data-testid="mock-overall">{result.overall}</p>
              <p className="mt-1 font-semibold">{result.headline}</p>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <StatCard icon={Target} label="Confidence" value={result.confidence} testid="mock-confidence" />
              <StatCard icon={MessageSquare} label="Communication" value={result.communication} testid="mock-communication" />
              <StatCard icon={Sparkles} label="Technical" value={result.technical} testid="mock-technical" />
            </div>

            {result.strengths?.length > 0 && (
              <section className="mt-6">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-sprout-mint mb-3">Strengths</h3>
                <ul className="space-y-2">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="flex gap-3 items-start text-zinc-200 text-[15px]" data-testid={`mock-strength-${i}`}>
                      <CheckCircle2 className="w-4 h-4 text-sprout-mint mt-1 shrink-0" />{s}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.improvements?.length > 0 && (
              <section className="mt-6">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400 mb-3">Improvements</h3>
                <ul className="space-y-2">
                  {result.improvements.map((s, i) => (
                    <li key={i} className="flex gap-3 items-start text-zinc-200 text-[15px]" data-testid={`mock-improvement-${i}`}>
                      <ArrowRight className="w-4 h-4 text-rose-400 mt-1 shrink-0" />{s}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Footer CTA */}
        <div
          className="fixed bottom-0 inset-x-0 z-[81] bg-sprout-bg/95 backdrop-blur-xl border-t border-sprout-border"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)", paddingTop: 12 }}
        >
          <div className="max-w-md mx-auto px-5">
            {onResult ? (
              <button
                onClick={onClose}
                className="w-full h-12 rounded-full bg-sprout-mint text-white font-semibold flex items-center justify-center gap-2"
                data-testid="mock-done-btn"
              >
                Done <CheckCircle2 className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={next}
                disabled={scoring}
                className="w-full h-12 rounded-full bg-sprout-mint text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                data-testid="mock-next-btn"
              >
                {step + 1 < n ? "Next question" : "Finish & score"}
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ---------------- Page ---------------- */
export default function Interviews() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [streak, setStreak] = useState({ streak: 0, sessions_total: 0, sessions_week: 0, best: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const [prep, st] = await Promise.all([
        api.get(`/coach/interview${refresh ? "?refresh=true" : ""}`),
        api.get("/coach/streak"),
      ]);
      setData(prep.data);
      setStreak(st.data);
    } catch (e) {
      if (e?.response?.status === 400) navigate("/onboarding");
      else toast.error(e?.response?.data?.detail || "Could not load coaching content");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (loading) {
    return (
      <AppPage className="sprout grid place-items-center bg-sprout-bg">
        <Loader2 className="w-5 h-5 animate-spin text-sprout-muted" />
      </AppPage>
    );
  }

  return (
    <AppPage className="sprout bg-sprout-bg text-white md:bg-transparent md:text-zinc-900 md:py-8">
      <header className="mx-auto flex w-full max-w-md shrink-0 items-center justify-between px-5 pt-6 md:hidden" data-testid="interviews-header">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-white" strokeWidth={2} />
          <h1 className="font-display font-bold text-3xl tracking-tight">Interviews</h1>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="text-sprout-mint text-sm font-semibold disabled:opacity-50"
          data-testid="interviews-refresh"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <AppPageScroll className={APP_CONTENT_WIDTH}>
      <DesktopPageHeader
        title="Interviews"
        subtitle="Practise role-specific questions and get instant AI feedback."
        actions={(
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-violet-600 hover:bg-violet-50 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      />
      <p className="mt-1 text-sm text-sprout-muted md:hidden">Practise role-specific questions and get instant AI feedback.</p>

      {/* Streak strip */}
      <div className="mt-5 flex gap-3" data-testid="interviews-streak">
        <StatCard icon={Flame}  label="Streak"      value={`${streak.streak}d`}        testid="streak-days" />
        <StatCard icon={Target} label="This week"   value={streak.sessions_week}      testid="streak-week" />
        <StatCard icon={Trophy} label="Best score"  value={streak.best || "—"}        testid="streak-best" />
      </div>

      {/* Start mock card */}
      <button
        onClick={() => setOpen(true)}
        className="mt-6 w-full text-left rounded-3xl p-6 bg-swiipr-gradient relative overflow-hidden"
        data-testid="start-mock-btn"
      >
        <Sparkles className="absolute -right-4 -top-4 w-32 h-32 text-white/10" />
        <p className="text-xs uppercase tracking-widest text-white/80 font-bold">5-question mock</p>
        <h2 className="mt-1 font-display font-black text-2xl leading-tight text-white">Start your mock interview</h2>
        <p className="mt-2 text-white/85 text-sm">Tailored to your target role. ~5 minutes. Get scored on confidence, communication, and technical answers.</p>
        <span className="mt-4 inline-flex items-center gap-1 font-semibold text-white">
          <Play className="w-4 h-4" fill="white" /> Start now
        </span>
      </button>

      {/* Tips */}
      {data?.tips?.length > 0 && (
        <section className="mt-7" data-testid="interview-tips">
          <h3 className="text-xs uppercase tracking-[0.16em] text-sprout-muted px-1 mb-3">Coach tips</h3>
          <ul className="space-y-2">
            {data.tips.map((t, i) => (
              <li key={i} className="flex gap-3 items-start p-3 rounded-xl bg-sprout-surface border border-sprout-border">
                <Sparkles className="w-4 h-4 text-sprout-mint mt-0.5 shrink-0" />
                <span className="text-zinc-200 text-[15px] leading-snug">{t}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Likely questions */}
      {data?.likely_questions?.length > 0 && (
        <section className="mt-7" data-testid="likely-questions">
          <div className="flex items-center justify-between px-1 mb-3">
            <h3 className="text-xs uppercase tracking-[0.16em] text-sprout-muted">Likely questions</h3>
            <span className="text-xs text-sprout-dim">{data.likely_questions.length}</span>
          </div>
          <div className="space-y-3">
            {data.likely_questions.map((q, i) => <QuestionPill key={i} q={q} />)}
          </div>
        </section>
      )}

      </AppPageScroll>

      <MockInterview
        open={open}
        questions={data?.mock_questions || []}
        onClose={() => setOpen(false)}
        onFinished={() => load(false)}
      />
    </AppPage>
  );
}
