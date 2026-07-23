import { Sparkles } from "lucide-react";
import { getLandingReviewColumns, getLandingReviewsCopy } from "../../lib/landingReviews";

const MARQUEE_COPIES = 4;

const MOBILE_CARD_CLASS = "w-[calc((100vw-3.75rem)/2)] max-w-[11.5rem]";

function ReviewCard({ name, subline, quote, className = "", compact = false }) {
  return (
    <article
      className={`shrink-0 rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        compact ? "p-3.5" : "p-5 sm:p-6"
      } ${className}`}
    >
      <p
        className={`font-display font-bold leading-snug text-zinc-900 ${
          compact ? "text-[0.85rem]" : "text-[0.95rem] sm:text-base"
        }`}
      >
        {name}
      </p>
      <p className={`mt-1 text-linkedin ${compact ? "text-[11px] leading-snug" : "text-sm"}`}>
        {subline}
      </p>
      <p
        className={`mt-2 leading-relaxed text-zinc-700 ${
          compact ? "line-clamp-4 text-[11px]" : "mt-3 text-sm"
        }`}
      >
        {quote}
      </p>
    </article>
  );
}

function ReviewTrack({ reviews, suffix, hidden = false, cardClassName = "w-full" }) {
  return (
    <div className="flex shrink-0 flex-col gap-4" aria-hidden={hidden || undefined}>
      {reviews.map((review) => (
        <ReviewCard key={`${review.id}-${suffix}`} {...review} className={cardClassName} />
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
        {Array.from({ length: MARQUEE_COPIES }, (_, copy) => `c${copy}`).map((suffix) => (
          <ReviewTrack key={suffix} reviews={reviews} suffix={suffix} hidden={suffix !== "c0"} />
        ))}
      </div>
    </div>
  );
}

function HorizontalReviewTrack({ reviews, suffix, hidden = false }) {
  return (
    <div className="flex shrink-0 items-stretch gap-3 pr-3" aria-hidden={hidden || undefined}>
      {reviews.map((review) => (
        <ReviewCard
          key={`${review.id}-${suffix}`}
          {...review}
          className={MOBILE_CARD_CLASS}
          compact
        />
      ))}
    </div>
  );
}

function MobileHorizontalReviewRow({ reviews, reverse = false, duration = 52 }) {
  return (
    <div className="pain-marquee-mask w-full overflow-hidden">
      <div
        className={`flex w-max flex-nowrap items-stretch ${reverse ? "pain-marquee-right" : "pain-marquee-left"}`}
        style={{ animationDuration: `${duration}s` }}
      >
        {Array.from({ length: MARQUEE_COPIES }, (_, copy) => `m${copy}`).map((suffix) => (
          <HorizontalReviewTrack
            key={suffix}
            reviews={reviews}
            suffix={suffix}
            hidden={suffix !== "m0"}
          />
        ))}
      </div>
    </div>
  );
}

function MobileHorizontalReviews({ leftColumn, rightColumn }) {
  return (
    <div className="-mx-6 mt-12 flex flex-col gap-4 px-6 md:hidden">
      <MobileHorizontalReviewRow reviews={leftColumn} duration={54} />
      <MobileHorizontalReviewRow reviews={rightColumn} reverse duration={48} />
    </div>
  );
}

export default function LandingReviews({ lang }) {
  const copy = getLandingReviewsCopy(lang);
  const [leftColumn, rightColumn] = getLandingReviewColumns(lang);

  return (
    <section className="relative overflow-hidden border-y border-zinc-100 gradient-linkedin-soft">
      <div
        className="pointer-events-none absolute inset-0 bg-grid mask-radial opacity-40"
        aria-hidden
      />
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

        <MobileHorizontalReviews leftColumn={leftColumn} rightColumn={rightColumn} />

        <div className="mt-12 hidden gap-4 md:grid md:grid-cols-2 md:gap-5">
          <VerticalReviewMarquee reviews={leftColumn} duration={54} />
          <VerticalReviewMarquee reviews={rightColumn} reverse duration={48} />
        </div>
      </div>
    </section>
  );
}
