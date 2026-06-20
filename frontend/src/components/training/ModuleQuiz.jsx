import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { scoreQuiz } from "../../lib/trainingQuizzes";

export default function ModuleQuiz({
  quiz,
  lang = "en",
  initialPassed = false,
  onSubmit,
  submitting = false,
}) {
  const labels = useMemo(
    () => (lang === "fr"
      ? {
          title: "Questionnaire",
          submit: "Valider mes réponses",
          retry: "Réessayer",
          passed: "Quiz réussi",
          failed: "Score insuffisant — relis le chapitre et réessaie.",
          score: "Score",
          required: "Réponds à toutes les questions.",
        }
      : {
          title: "Knowledge check",
          submit: "Submit answers",
          retry: "Try again",
          passed: "Quiz passed",
          failed: "Score too low — review the chapter and try again.",
          score: "Score",
          required: "Answer every question.",
        }),
    [lang],
  );

  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(initialPassed ? { passed: true, score: 100 } : null);

  if (!quiz?.questions?.length) return null;

  const allAnswered = quiz.questions.every((q) => answers[q.id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!allAnswered || submitting) return;
    const scored = scoreQuiz(quiz, answers);
    if (onSubmit) {
      const remote = await onSubmit(quiz.quiz_id, answers, scored);
      setResult(remote || scored);
    } else {
      setResult(scored);
    }
  };

  const handleRetry = () => {
    setAnswers({});
    setResult(null);
  };

  if (result?.passed) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <p className="font-semibold">{labels.passed}</p>
        </div>
        <p className="mt-1 text-sm text-emerald-700">
          {labels.score}: {result.score}%
        </p>
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

      <div className="mt-5 space-y-6">
        {quiz.questions.map((question, index) => (
          <fieldset key={question.id} className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-800">
              {index + 1}. {question.prompt}
            </legend>
            <div className="space-y-2">
              {question.options.map((option) => {
                const checked = answers[question.id] === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                      checked
                        ? "border-violet-400 bg-white ring-1 ring-violet-200"
                        : "border-zinc-200 bg-white/80 hover:border-violet-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={option.id}
                      checked={checked}
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

      {result && !result.passed ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {labels.failed} ({labels.score}: {result.score}%)
          </span>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!allAnswered || submitting}
          className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {labels.submit}
        </button>
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
      </div>

      {!allAnswered ? (
        <p className="mt-3 text-xs text-zinc-500">{labels.required}</p>
      ) : null}
    </form>
  );
}
