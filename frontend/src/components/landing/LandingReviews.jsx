import { MessageCircleHeart, Star, Zap } from "lucide-react";
import {
  getLandingReviewColumns,
  getLandingReviewsCopy,
} from "../../lib/landingReviews";

const MARQUEE_COPIES = 4;

function ReviewCard({ name, subline, quote }) {
  return (
    <article className="w-full shrink-0 rounded-xl border border-zinc-200/80 bg-zinc-50 p-4 shadow-[0_0_2px_rgba(0,0,0,0.08)]">
      <div className="mb-3">
        <p className="text-sm font-semibold text-zinc-900">{name}</p>
        <p className="text-xs text-zinc-500">{subline}</p>
      </div>
      <p className="text-sm leading-relaxed text-zinc-700">{quote}</p>
    </article>
  );
}

function ReviewTrack({ reviews, suffix, hidden = false }) {
  return (
    <div className="flex shrink-0 flex-col gap-5" aria-hidden={hidden || undefined}>
      {reviews.map((review) => (
        <ReviewCard key={`${review.id}-${suffix}`} {...review} />
      ))}
    </div>
  );
}

function VerticalReviewMarquee({ reviews, reverse = false, duration = 52 }) {
  return (
    <div className="reviews-marquee-mask relative h-[min(540px,72vh)] overflow-hidden">
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

function RatingCard({ label, suffix, icon }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50 px-4 py-3 shadow-[0_0_2px_rgba(0,0,0,0.08)]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-linkedin shadow-sm">
        {icon === "speed" ? (
          <Zap className="h-5 w-5" aria-hidden />
        ) : (
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" aria-hidden />
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-900">{label}</p>
        <p className="text-xs text-zinc-500">{suffix}</p>
      </div>
    </div>
  );
}

export default function LandingReviews({ lang }) {
  const copy = getLandingReviewsCopy(lang);
  const [leftColumn, rightColumn] = getLandingReviewColumns(lang);

  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-lg bg-linkedin-light px-3 py-2 text-sm font-medium text-linkedin">
          <MessageCircleHeart className="h-4 w-4 shrink-0" aria-hidden />
          {copy.badge}
        </div>
        <h2 className="font-display text-3xl font-bold tracking-tight text-zinc-500 sm:text-4xl">
          <span className="text-zinc-900">{copy.titleLead} </span>
          {copy.titleAccent}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-zinc-500 sm:text-base">
          {copy.subtitle}
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-2">
        <VerticalReviewMarquee reviews={leftColumn} duration={54} />
        <VerticalReviewMarquee reviews={rightColumn} reverse duration={48} />
      </div>

      <div className="mx-auto mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
        {copy.ratings.map((rating) => (
          <RatingCard key={rating.label} {...rating} />
        ))}
      </div>
    </section>
  );
}
