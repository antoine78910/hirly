import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { sel } from "../lib/selectionTheme";

const REPORT_REASONS = [
  {
    id: "not_relevant",
    title: "Not relevant to my search",
    hint: "This job doesn't match my search criteria",
  },
  {
    id: "duplicate",
    title: "Duplicate listing",
    hint: "I've seen this exact job posted multiple times",
  },
  {
    id: "inactive",
    title: "Job no longer active",
    hint: "This position has been filled or is no longer available",
  },
  {
    id: "inappropriate",
    title: "Inappropriate content",
    hint: "This job posting contains inappropriate or misleading content",
  },
  {
    id: "other",
    title: "Other",
    hint: "Something else is wrong with this listing",
  },
];

export default function ReportJobSheet({ open, job, onClose, onSubmit }) {
  const [reason, setReason] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setReason(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit?.(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && job ? (
        <>
          <motion.button
            type="button"
            aria-label="Close report"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40"
            onClick={onClose}
            data-testid="report-job-backdrop"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-job-title"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed inset-x-0 bottom-0 z-[61] mx-auto max-h-[88dvh] w-full max-w-md overflow-hidden rounded-t-3xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl"
            data-testid="report-job-sheet"
          >
            <div className="flex justify-center pt-3">
              <div className="h-1 w-10 rounded-full bg-zinc-200" />
            </div>

            <div className="flex items-center justify-between px-5 pb-2 pt-3">
              <h2 id="report-job-title" className="font-display text-xl font-bold">
                Report Job
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
                aria-label="Close"
                data-testid="report-job-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 pb-safe" style={{ maxHeight: "calc(88dvh - 8.5rem)" }}>
              <p className="text-sm text-zinc-500">
                Help us improve by reporting issues with this job listing
              </p>

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="font-semibold text-zinc-900">{job.title}</p>
                <p className="mt-0.5 text-sm text-zinc-500">{job.company}</p>
              </div>

              <p className="mt-6 text-sm font-semibold text-zinc-800">What&apos;s wrong with this job?</p>

              <ul className="mt-3 space-y-2 pb-4">
                {REPORT_REASONS.map((item) => {
                  const active = reason === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setReason(item.id)}
                        className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                          active ? sel.optionOn : sel.optionOff
                        }`}
                        data-testid={`report-reason-${item.id}`}
                      >
                        <span
                          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                            active ? "border-linkedin bg-linkedin" : "border-zinc-300 bg-white"
                          }`}
                        >
                          {active ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-zinc-900">{item.title}</span>
                          <span className="mt-0.5 block text-sm text-zinc-500">{item.hint}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div
              className="border-t border-zinc-200 bg-white px-5 pt-3"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
            >
              <button
                type="button"
                disabled={!reason || submitting}
                onClick={submit}
                className="w-full rounded-full gradient-linkedin py-3.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="report-job-submit"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
