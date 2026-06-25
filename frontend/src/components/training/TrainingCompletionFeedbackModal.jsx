import { useState } from "react";
import { GraduationCap, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const BENEFICIAL_OPTIONS = [
  { id: "very", label: "Oui, beaucoup" },
  { id: "somewhat", label: "Plutôt oui" },
  { id: "not_really", label: "Pas vraiment" },
];

export default function TrainingCompletionFeedbackModal({
  open,
  courseId,
  onDismiss,
  onSubmitted,
}) {
  const [beneficial, setBeneficial] = useState("very");
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!courseId || submitting) return;
    setSubmitting(true);
    try {
      await api.post("/feedback/training-completion", {
        course_id: courseId,
        beneficial,
        rating,
        message: message.trim(),
      });
      toast.success("Merci pour votre retour !");
      onSubmitted?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Impossible d'envoyer votre retour");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss?.({ submitted: false }); }}>
      <DialogContent
        className="max-w-md gap-0 overflow-hidden border-violet-200 p-0 sm:rounded-3xl"
        data-testid="training-completion-feedback-modal"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-6 py-7 text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <GraduationCap className="h-6 w-6" />
          </div>
          <DialogHeader className="space-y-2 text-center sm:text-center">
            <DialogTitle className="font-display text-2xl font-black tracking-tight text-white">
              Formation terminée !
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-violet-100">
              Bravo — vous avez complété l&apos;intégralité du programme. Votre avis nous aide à l&apos;améliorer.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form className="space-y-4 px-6 py-5" onSubmit={handleSubmit}>
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              Cette formation vous a-t-elle été utile ?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BENEFICIAL_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBeneficial(option.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    beneficial === option.id
                      ? "border-violet-400 bg-violet-50 text-violet-700"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-zinc-900">Note globale</p>
            <div className="mt-2 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  className="rounded-md p-1 transition-transform hover:scale-110"
                  aria-label={`${value} étoile${value > 1 ? "s" : ""}`}
                >
                  <Star
                    className={`h-6 w-6 ${
                      value <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-zinc-900">
              Retours, critiques ou suggestions (optionnel)
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Ce qui vous a plu, ce qui manque, ce qu'on pourrait améliorer…"
              className="mt-2 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/60"
              data-testid="training-feedback-message"
            />
          </label>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-full font-bold"
              data-testid="training-feedback-submit"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Envoyer mon retour"}
            </Button>
            <button
              type="button"
              onClick={() => onDismiss?.({ submitted: false })}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
            >
              Plus tard
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
