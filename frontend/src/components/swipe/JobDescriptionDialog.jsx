import { BookOpen, Briefcase, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { getJobDisplayContent, getJobDisplayTitle } from "../../lib/jobDisplayUtils";
import { translateLocationLabel } from "../../lib/localizedDisplay";
import JobOfferDetails from "./JobOfferDetails";

function stopCardGesture(event) {
  event.stopPropagation();
}

export default function JobDescriptionDialog({ job, t, lang, className = "" }) {
  const { fullDescription, detailSections } = getJobDisplayContent(job);
  const title = getJobDisplayTitle(job, { lang });
  const company = job?.company || "Company";
  const location = translateLocationLabel(job?.location, lang) || t("swipe.locationNotSpecified");

  const hasStructuredDetails = detailSections?.some((section) => section?.bullets?.length);
  const hasFullDescription = Boolean(fullDescription);
  if (!hasFullDescription && !hasStructuredDetails) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center gap-2 rounded-full border border-sprout-mint/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:border-sprout-mint/60 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-sprout-mint/60 ${className}`}
          onClick={stopCardGesture}
          onPointerDown={stopCardGesture}
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t("swipe.viewFullOffer")}
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-w-3xl border-white/10 bg-sprout-midnight p-0 text-white shadow-2xl"
        onClick={stopCardGesture}
        onPointerDown={stopCardGesture}
      >
        <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-7">
          <DialogHeader className="space-y-3 pr-8 text-left">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sprout-mint">
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                {company}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {location}
              </span>
            </div>
            <DialogTitle className="font-display text-2xl font-black leading-tight text-white">
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm text-sprout-muted">
              {t("swipe.fullOfferDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-5">
            <JobOfferDetails job={job} t={t} lang={lang} compact />

            {hasFullDescription ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-sprout-mint">
                  {t("swipe.fullOfferDescription")}
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-7 text-sprout-muted">
                  {fullDescription}
                </p>
              </section>
            ) : null}

            {hasStructuredDetails ? (
              <section className="space-y-3">
                {detailSections.map((section) => (
                  <div key={section.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-white">
                      {section.title}
                    </h3>
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-sprout-muted">
                      {section.bullets.map((bullet, index) => (
                        <li key={`${section.title}-${index}`} className="flex items-start gap-2">
                          <span className="mt-2 text-[8px] text-sprout-mint">●</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
