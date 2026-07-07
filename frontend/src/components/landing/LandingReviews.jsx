import { Sparkles } from "lucide-react";
import {
  getLandingReviewColumns,
  getLandingReviewsCopy,
} from "../../lib/landingReviews";

const MARQUEE_COPIES = 4;

function ReviewCard({ name, subline, quote }) {
  return (
    <article className="w-full shrink-0 rounded-xl border border-zinc-200/80 bg-white p-4 shadow-[0_0_2px_rgba(0,0,0,0.08)] sm:p-5">
      <div className="mb-3">
        <p className="font-display text-[0.95rem] font-bold leading-snug text-zinc-900 sm:text-base">
          {name}
        </p>
        <p className="mt-0.5 text-xs font-medium text-linkedin">{subline}</p>
      </div>
      <p className="text-sm leading-relaxed text-zinc-600">{quote}</p>
    </article>
  );
}

function ReviewTrack({ reviews, suffix, hidden = false }) {
  return (
    <div className="flex shrink-0 flex-col gap-4" aria-hidden={hidden || undefined}>
      {reviews.map((review) => (
        <ReviewCard key={`${review.id}-${suffix}`} {...review} />
      ))}
    </div>
  );
}

function VerticalReviewMarquee({ reviews, reverse = false, duration = 52 }) {
  return (
    <div className="reviews-marquee-mask relative h-[min(520px,70vh)] overflow-hidden">
      <div
        className={`flex flex-col ${reverse ? "reviews-marquee-down" : "reviews-marquee-up"}`}
        style={{ animationDuration: `${duration}s` }}
      >
        {Array.from({ length: MARQUEE_COPIES }, (_, copy) => (
          <ReviewTrack
            key={copy}
            reviews={reviews}
            suffix={`c${copy}`}
            hidden={copy > 0}
          />
        ))}
      </div>
    </div>
  );
}

export default function LandingReviews({ lang }) {
  const copy = getLandingReviewsCopy(lang);
  const [leftColumn, rightColumn] = getLandingReviewColumns(lang);

  return (
    <section className="relative overflow-hidden border-y border-zinc-100 gradient-linkedin-soft">
      <div className="pointer-events-none absolute inset-0 bg-grid mask-radial opacity-40" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-linkedin/20 bg-white px-3 py-1.5 text-xs font-semibold text-linkedin shadow-sm">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {copy.badge}
          </div>
          <h2 className="font-display text-3xl font-black tracking-tighter text-zinc-900 sm:text-4xl lg:text-5xl">
            {copy.title}
          </h2>
          <p className="mt-2 font-display text-xl font-bold tracking-tight text-zinc-800 sm:text-2xl">
            <span className="italic text-swiipr-gradient">{copy.titleAccent}</span>
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-500 sm:text-base">
            {copy.subtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 md:gap-5">
          <VerticalReviewMarquee reviews={leftColumn} duration={54} />
          <VerticalReviewMarquee reviews={rightColumn} reverse duration={48} />
        </div>
      </div>
    </section>
  );
}
