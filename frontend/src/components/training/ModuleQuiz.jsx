import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronRight, Loader2, PartyPopper, RotateCcw, XCircle } from "lucide-react";
import { scoreQuiz } from "../../lib/trainingQuizzes";

function QuizCelebration() {
  const particles = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({
      id: i,
      angle: (i / 14) * Math.PI * 2,
      distance: 36 + (i % 5) * 10,
      color: i % 3 === 0 ? "#10b981" : i % 3 === 1 ? "#7c3aed" : "#f59e0b",
      size: i % 2 === 0 ? 8 : 6,
    })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{ width: p.size, height: p.size, backgroundColor: p.color }}
          initial={{ x: "-50%", y: "-50%", opacity: 0, scale: 0 }}
          animate={{
            x: `calc(-50% + ${Math.cos(p.angle) * p.distance}px)`,
            y: `calc(-50% + ${Math.sin(p.angle) * p.distance}px)`,
            opacity: [0, 1, 0],
            scale: [0, 1.2, 0.4],
          }}
          transition={{ duration: 0.75, ease: "easeOut", delay: p.id * 0.02 }}
        />
      ))}
    </div>
  );
}

function QuizResultBanner({ passed, score, labels, celebrate }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={`relative overflow-hidden rounded-xl border px-4 py-3 ${
        passed
          ? "border-emerald-200 bg-gradient-to-r from-emerald-50 to-violet-50"
          : "border-rose-200 bg-rose-50"
      }`}
    >
      {passed && celebrate ? <QuizCelebration /> : null}
      <div className={`relative flex items-center gap-2 ${passed ? "text-emerald-800" : "text-rose-800"}`}>
        {passed ? (
          <motion.span
            initial={celebrate ? { scale: 0, rotate: -20 } : false}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 16, delay: 0.1 }}
          >
            <PartyPopper className="h-5 w-5 shrink-0" aria-hidden />
          </motion.span>
        ) : (
          <XCircle className="h-5 w-5 shrink-0" aria-hidden />
        )}
        <div>
          <p className="font-semibold">{passed ? labels.passedShort : labels.failedShort}</p>
          <p className={`text-sm ${passed ? "text-emerald-700" : "text-rose-700"}`}>
            {labels.score}: {score}%
            {!passed ? ` — ${labels.failedHint}` : ""}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function ModuleQuiz({
  quiz,
  lang = "fr",
  initialPassed = false,
  onSubmit,
  onContinue,
  submitting = false,
  continuing = false,
}) {
  const labels = useMemo(
    () => (lang === "fr"
      ? {
          title: "Questionnaire",
          submit: "Valider mes réponses",
          retry: "Réessayer",
          passed: "Quiz réussi",
          passedShort: "Validé !",
          failedShort: "Pas encore validé",
          failedHint: "relis le chapitre et réessaie",
          failed: "Score insuffisant — relis le chapitre et réessaie.",
          score: "Score",
          required: "Réponds à toutes les questions.",
          continue: "Passer à la suite",
          alreadyPassed: "Tu as déjà validé ce quiz.",
          retake: "Refaire le test",
        }
      : {
          title: "Knowledge check",
          submit: "Submit answers",
          retry: "Try again",
          passed: "Quiz passed",
          passedShort: "Passed!",
          failedShort: "Not passed yet",
          failedHint: "review the chapter and try again",
          failed: "Score too low — review the chapter and try again.",
          score: "Score",
          required: "Answer every question.",
          continue: "Continue to next part",
          alreadyPassed: "You already passed this quiz.",
          retake: "Retake quiz",
        }),
    [lang],
  );

  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [retaking, setRetaking] = useState(false);

  if (!quiz?.questions?.length) return null;

  const showRevisitPassed = initialPassed && !hasSubmitted && !retaking;
  const locked = Boolean(result?.passed);
  const allAnswered = quiz.questions.every((q) => answers[q.id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!allAnswered || submitting || locked) return;
    const scored = scoreQuiz(quiz, answers);
    setHasSubmitted(true);
    if (onSubmit) {
      const remote = await onSubmit(quiz.quiz_id, answers, scored);
      const finalResult = remote || scored;
      setResult(finalResult);
      if (finalResult.passed) setCelebrate(true);
    } else {
      setResult(scored);
      if (scored.passed) setCelebrate(true);
    }
  };

  const handleRetry = () => {
    setAnswers({});
    setResult(null);
    setCelebrate(false);
    setRetaking(true);
  };

  if (showRevisitPassed) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <p className="font-semibold">{labels.passed}</p>
        </div>
        <p className="mt-1 text-sm text-emerald-700">{labels.alreadyPassed}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {labels.retake}
          </button>
          {onContinue ? (
            <button
              type="button"
              onClick={onContinue}
              disabled={continuing}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {labels.continue}
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 sm:p-6"
    >
      <h3 className="font-display text-lg font-bold text-zinc-900">
        {quiz.title || labels.title}
      </h3>

      <AnimatePresence>
        {result ? (
          <div className="mt-4">
            <QuizResultBanner
              passed={result.passed}
              score={result.score}
              labels={labels}
              celebrate={celebrate && result.passed}
            />
          </div>
        ) : null}
      </AnimatePresence>

      <div className="mt-5 space-y-6">
        {quiz.questions.map((question, index) => (
          <fieldset key={question.id} className="space-y-3" disabled={locked}>
            <legend className="text-sm font-semibold text-zinc-800">
              {index + 1}. {question.prompt}
            </legend>
            <div className="space-y-2">
              {question.options.map((option) => {
                const checked = answers[question.id] === option.id;
                const showFeedback = Boolean(result);
                const isCorrect = option.id === question.correct;
                const isWrongPick = showFeedback && checked && !isCorrect;

                let optionClass = checked
                  ? "border-violet-400 bg-white ring-1 ring-violet-200"
                  : "border-zinc-200 bg-white/80 hover:border-violet-200";

                if (showFeedback && isCorrect) {
                  optionClass = "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200";
                } else if (isWrongPick) {
                  optionClass = "border-rose-300 bg-rose-50 ring-1 ring-rose-200";
                }

                return (
                  <label
                    key={option.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                      locked ? "cursor-default" : "cursor-pointer"
                    } ${optionClass}`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={option.id}
                      checked={checked}
                      disabled={locked}
                      onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: option.id }))}
                      className="mt-0.5 shrink-0 accent-violet-600"
                    />
                    <span className="text-zinc-700">{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {!locked ? (
          <button
            type="submit"
            disabled={!allAnswered || submitting}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {labels.submit}
          </button>
        ) : null}

        {result && !result.passed ? (
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {labels.retry}
          </button>
        ) : null}

        {result?.passed ? (
          <>
            {onContinue ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, type: "spring", stiffness: 400, damping: 22 }}
                onClick={onContinue}
                disabled={continuing}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {labels.continue}
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            ) : null}
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {labels.retake}
            </button>
          </>
        ) : null}
      </div>

      {!allAnswered && !locked ? (
        <p className="mt-3 text-xs text-zinc-500">{labels.required}</p>
      ) : null}
    </form>
  );
}
