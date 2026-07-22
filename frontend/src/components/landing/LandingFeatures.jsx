import {
  ArrowRight,
  BarChart3,
  Check,
  FileText,
  LayoutDashboard,
  Loader2,
  Mail,
  MapPin,
  RefreshCw,
  Shield,
  Smartphone,
  Sparkles,
  Workflow,
  Zap,
  Kanban,
} from "lucide-react";
import { getLandingFeaturesCopy } from "../../lib/landingFeatures";

const HIGHLIGHT_ICONS = {
  secure: Shield,
  sync: RefreshCw,
  dashboard: LayoutDashboard,
  cover_letters: Mail,
  resume: FileText,
  insights: BarChart3,
  experience: Workflow,
  everywhere: Smartphone,
};

const FEATURE_ICONS = {
  personalization: Sparkles,
  auto_apply: Zap,
  tracking: Kanban,
};

const STATUS_STYLES = {
  purple: "bg-purple-100 text-purple-700",
  blue: "bg-sky-100 text-sky-700",
  indigo: "bg-indigo-100 text-indigo-700",
  amber: "bg-amber-100 text-amber-800",
};

function FeatureBadge({ children }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg bg-linkedin-light/80 px-3 py-1.5 text-sm font-semibold text-linkedin">
      <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function FeatureCardHeader({ icon: Icon, title, lead, body }) {
  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 shrink-0 text-linkedin" aria-hidden />
          <h3 className="font-display text-lg font-bold text-zinc-900 sm:text-xl">{title}</h3>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
      </div>
      <p className="text-sm leading-relaxed text-zinc-600">
        <span className="font-medium text-zinc-900">{lead}</span> {body}
      </p>
    </header>
  );
}

function PersonalizationMock({ generatingLabel }) {
  return (
    <div className="relative mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
      <div className="border-b border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="bg-[length:200%_100%] bg-gradient-to-r from-linkedin via-violet-500 to-linkedin bg-clip-text text-sm font-semibold text-transparent animate-[landing-shimmer_1.8s_linear_infinite]">
            Hirly AI
          </span>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-linkedin/70" aria-hidden />
        </div>
        <p className="mt-1 text-xs text-zinc-500">{generatingLabel}</p>
      </div>
      <div className="space-y-2 p-4">
        <div className="h-2 w-4/5 rounded-full bg-zinc-200/90" />
        <div className="h-2 w-full rounded-full bg-zinc-200/80" />
        <div className="h-2 w-11/12 rounded-full bg-zinc-200/70" />
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full gradient-linkedin" />
            <div className="space-y-1.5">
              <div className="h-2 w-24 rounded bg-zinc-200" />
              <div className="h-2 w-16 rounded bg-zinc-100" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full rounded bg-linkedin/15" />
            <div className="h-1.5 w-5/6 rounded bg-linkedin/10" />
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-50 to-transparent" />
    </div>
  );
}

function AiApplyMock({ successLabel }) {
  return (
    <div className="relative mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-zinc-200" />
          <span className="h-2 w-2 rounded-full bg-zinc-200" />
          <span className="h-2 w-2 rounded-full bg-zinc-200" />
        </div>
        <span className="text-[10px] font-medium text-zinc-400">Hirly</span>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5">
          <div className="h-6 w-6 rounded-full bg-zinc-200" />
          <span className="text-xs text-zinc-500">Alex Martin</span>
        </div>
      </div>
      <div className="relative px-4 pb-8 pt-2">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-linkedin/15 bg-linkedin-light/40 px-4 py-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-sm">
            <Check className="h-7 w-7 text-linkedin" strokeWidth={2.5} aria-hidden />
          </div>
          <p className="text-sm font-medium text-zinc-800">{successLabel}</p>
        </div>
      </div>
    </div>
  );
}

function TrackerCard({ company, role, location, status, statusTone, activity, className = "" }) {
  return (
    <article
      className={`shrink-0 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 sm:w-[240px] ${className || "w-[min(82vw,260px)]"}`}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-xs font-bold text-linkedin shadow-sm">
          {company.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <h4 className="truncate font-display text-sm font-bold text-zinc-900">{role}</h4>
          <p className="truncate text-xs text-zinc-500">{company}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2 text-xs text-zinc-500">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{location}</span>
        </div>
        <p className="text-zinc-400">{activity}</p>
      </div>
      <div className="mt-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[statusTone] ?? STATUS_STYLES.blue}`}
        >
          {status}
        </span>
      </div>
    </article>
  );
}

function TrackingPhoneGallery({ cards }) {
  return (
    <div className="trust-marquee-mask mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 py-4 lg:hidden">
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {cards.map((card) => (
          <TrackerCard
            key={card.company}
            {...card}
            className="w-[min(82vw,260px)] shrink-0 snap-center"
          />
        ))}
      </div>
    </div>
  );
}

function TrackingMarquee({ cards }) {
  const copies = 3;
  return (
    <div className="trust-marquee-mask mt-6 hidden overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 py-4 lg:block">
      <div
        className="pain-marquee-left flex w-max flex-nowrap gap-3"
        style={{ animationDuration: "42s" }}
      >
        {Array.from({ length: copies }, (_, copy) => (
          <div key={copy} className="flex gap-3 pr-3" aria-hidden={copy > 0 || undefined}>
            {cards.map((card) => (
              <TrackerCard key={`${card.company}-${copy}`} {...card} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function HighlightCard({ icon: Icon, title, body }) {
  return (
    <li className="flex flex-col items-center text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-md bg-white shadow-[0_0_2px_rgba(0,0,0,0.2)]">
        <Icon className="h-5 w-5 text-linkedin" aria-hidden />
      </div>
      <h4 className="font-display text-sm font-bold text-zinc-900">{title}</h4>
      <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-zinc-500">{body}</p>
    </li>
  );
}

export default function LandingFeatures({ lang }) {
  const copy = getLandingFeaturesCopy(lang);
  const [personalization, autoApply, tracking] = copy.features;

  return (
    <section className="border-y border-zinc-100 bg-white">
      <style>{`
        @keyframes landing-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="max-w-3xl">
          <FeatureBadge>{copy.badge}</FeatureBadge>
          <h2 className="mt-5 font-display text-3xl font-black tracking-tight text-zinc-900 sm:text-4xl lg:text-[2.65rem] lg:leading-[1.1]">
            {copy.title} <span className="text-zinc-500">{copy.titleMuted}</span>
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
            {copy.subtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md sm:p-6">
            <FeatureCardHeader
              icon={FEATURE_ICONS[personalization.id]}
              title={personalization.title}
              lead={personalization.lead}
              body={personalization.body}
            />
            <PersonalizationMock generatingLabel={copy.aiGenerating} />
          </article>

          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md sm:p-6">
            <FeatureCardHeader
              icon={FEATURE_ICONS[autoApply.id]}
              title={autoApply.title}
              lead={autoApply.lead}
              body={autoApply.body}
            />
            <AiApplyMock successLabel={copy.aiApplySuccess} />
          </article>
        </div>

        <article className="mt-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md sm:p-6">
          <FeatureCardHeader
            icon={FEATURE_ICONS[tracking.id]}
            title={tracking.title}
            lead={tracking.lead}
            body={tracking.body}
          />
          <TrackingPhoneGallery cards={copy.trackerCards} />
          <TrackingMarquee cards={copy.trackerCards} />
        </article>

        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {copy.highlights.map((item) => (
            <HighlightCard
              key={item.id}
              icon={HIGHLIGHT_ICONS[item.id]}
              title={item.title}
              body={item.body}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
