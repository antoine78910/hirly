import { useEffect, useState, useCallback, useRef } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  Zap, Undo2, History, SlidersHorizontal, Flag, Share2, MapPin, Calendar,
  Briefcase, Building2, BarChart3, Laptop, Info, Heart, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import CompanyLogo from "../components/CompanyLogo";
import FiltersModal from "../components/FiltersModal";
import TargetSearchSheet from "../components/TargetSearchSheet";
import ReportJobSheet from "../components/ReportJobSheet";
import { BRAND } from "../lib/brand";
import { shareJob } from "../lib/shareJob";
import { trackEvent } from "../lib/analytics";

const DEFAULT_SEARCH_RADIUS = "50km";
const FILTERS_STORAGE_KEY = "swiipr.jobs.filters.v1";

const readPersistedFilters = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
};

const savePersistedFilters = (filters) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (_) {}
};

const clearPersistedFilters = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FILTERS_STORAGE_KEY);
  } catch (_) {}
};

const hasActiveFilters = (value) => {
  if (!value) return false;
  return Boolean(
    value.minSalary > 0
    || (value.postedDate && value.postedDate !== "any")
    || (value.workLocations || []).length
    || (value.jobTypes || []).length
    || (value.experience || []).length
    || (value.locations || []).length
    || (value.locationsData || []).length
    || value.locationData
    || (value.onlyCompanies || []).length
    || (value.hideCompanies || []).length
    || (value.onlyIndustries || []).length
    || (value.hideIndustries || []).length
    || value.includeUnknownLocation === false
    || value.includeUnknownSalary === false
    || (value.searchRadius && value.searchRadius !== DEFAULT_SEARCH_RADIUS)
    || value.onlyMyCountry
  );
};

/* ============================================================
   Swipper card — Tinder-style swipe physics.
   - Front face: company logo, name, short blurb, big title, tag pills.
   - Back face (flipped on tap): job summary + qualifications, scrollable.
   - Free 2D drag (x AND y), with stamps following Tinder convention:
       • Drag RIGHT → APPLY  (mint stamp, top-left, rotated -16deg)
       • Drag LEFT  → SKIP   (rose stamp, top-right, rotated +16deg)
============================================================ */

const formatPosted = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return "Posted today";
  if (diff === 1) return "Posted 1 day ago";
  return `Posted ${diff} days ago`;
};

const companySize = (j) => {
  // We don't have this in mock data — fall back to a deterministic-ish bucket
  const buckets = ["11-50 employees", "51-500 employees", "501-1000 employees", "1001-5000 employees"];
  let h = 0;
  for (const c of (j.company || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return buckets[h % buckets.length];
};

const industryFor = (j) => {
  const stack = (j.tech_stack || []).join(" ").toLowerCase();
  if (j.title.toLowerCase().includes("design")) return "Product Design";
  if (stack.includes("rust") || stack.includes("go") || stack.includes("postgres")) return "Infrastructure";
  if (stack.includes("ml") || stack.includes("pytorch") || stack.includes("transformers")) return "AI / ML";
  if (j.title.toLowerCase().includes("marketing") || j.title.toLowerCase().includes("growth")) return "Marketing";
  return "Technology";
};

const seniorityLabel = (j) => {
  const m = { junior: "Entry Level", mid: "Mid Level", senior: "Senior", lead: "Lead", principal: "Principal" };
  return m[j.seniority] || "Full Time";
};

const workModelIcon = (v) => ({
  remote: Laptop, hybrid: Laptop, onsite: Building2,
}[v] || Laptop);

const workModelLabel = (v) => ({
  remote: "Remote", hybrid: "Hybrid", onsite: "In Person",
}[v] || v || "Hybrid");

const stripHtml = (value = "") => {
  const withBreaks = String(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const textarea = document.createElement("textarea");
  textarea.innerHTML = withoutTags;
  return textarea.value.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
};

const safeDescription = (job) => stripHtml(job.clean_description || job.description || "");

const descriptionPreview = (job) => {
  const firstSection = job.job_description_sections?.find((s) => s?.bullets?.length);
  if (firstSection) return firstSection.bullets.slice(0, 2).map(stripHtml).join(" ");
  return safeDescription(job);
};

const swipeSuccessCopy = (data, job) => {
  const submission = data?.submission_status || "not_submitted";
  const pkg = data?.package_status || data?.application_status;

  if (submission === "prepared") {
    return {
      title: "Application prepared",
      description: `${job.company} is ready in Tracker. Not submitted yet.`,
    };
  }
  if (submission === "action_required" || submission === "blocked") {
    return {
      title: "Action required",
      description: "Open Tracker to answer the remaining application questions.",
    };
  }
  if (submission === "blocked_captcha") {
    return {
      title: "Human verification needed",
      description: "Open Tracker to complete the manual verification step.",
    };
  }
  if (submission === "prepare_failed") {
    return {
      title: "Application package generated",
      description: "Browser preparation failed. You can retry from Tracker.",
    };
  }

  if (pkg === "generated_text_only") {
    return {
      title: "Application text generated",
      description: "CV and cover letter text are ready, but the file package needs review.",
    };
  }
  if (pkg === "needs_profile_data") {
    return {
      title: "More profile data needed",
      description: "Complete your CV/profile to generate a stronger application.",
    };
  }
  if (pkg === "needs_job_data") {
    return {
      title: "More job data needed",
      description: "This job post does not include enough detail for a strong tailored package.",
    };
  }
  if (pkg === "failed") {
    return {
      title: "Application saved",
      description: "Generation failed. Open Tracker to review or retry later.",
    };
  }

  return {
    title: `Application package generated for ${job.company}`,
    description: "CV and cover letter are ready. Not submitted yet.",
  };
};

const swipeErrorMessage = (e) => {
  if (e?.code === "ECONNABORTED") {
    return "Application generation is still taking longer than expected. Check Tracker in a moment.";
  }
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.message) return detail.message;
  return "Swipe failed";
};

const trackApplicationOutcome = (data, job) => {
  if (!data?.applied) return;
  const base = {
    job_id: job?.job_id,
    company: job?.company,
    ats_provider: job?.ats_provider,
    submission_status: data?.submission_status,
    package_status: data?.package_status || data?.application_status,
  };
  trackEvent("application_generated", base);
  const submission = data?.submission_status;
  if (submission === "prepared" || submission === "ready") trackEvent("application_prepared", base);
  if (submission === "action_required") trackEvent("application_action_required", base);
  if (submission === "blocked" || submission === "blocked_captcha") trackEvent("application_blocked", base);
  if (submission === "prepare_failed" || submission === "failed") trackEvent("application_prepare_failed", base);
  if (submission === "submitted") trackEvent("application_submitted", base);
};

function DescriptionSections({ job }) {
  const sections = (job.job_description_sections || [])
    .filter((section) => section?.title && Array.isArray(section.bullets) && section.bullets.length)
    .slice(0, 4);

  if (!sections.length) {
    return <p className="mt-2 text-sprout-muted leading-relaxed whitespace-pre-line">{safeDescription(job)}</p>;
  }

  return (
    <div className="mt-3 space-y-5">
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="font-display font-bold text-white text-lg">{stripHtml(section.title)}</h3>
          <ul className="mt-2 space-y-2">
            {section.bullets.slice(0, 5).map((bullet, i) => (
              <li key={`${section.title}-${i}`} className="flex gap-2 text-sprout-muted leading-relaxed">
                <span className="text-sprout-mint">•</span>
                <span>{stripHtml(bullet)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Pill({ icon: Icon, children, mint }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium ${
      mint ? "bg-sprout-mint-soft text-sprout-mint" : "bg-sprout-surface-2 text-zinc-100"
    }`}>
      {Icon && <Icon className="w-3.5 h-3.5 text-sprout-mint" strokeWidth={2} />}
      {children}
    </span>
  );
}

function stopCardTap(e) {
  e.stopPropagation();
  e.preventDefault();
}

function CardFront({ job, onReport, onShare, actionsEnabled }) {
  return (
    <div className="absolute inset-0 backface-hidden bg-sprout-surface border border-sprout-border rounded-[28px] overflow-hidden flex flex-col">
      {/* top bar: flag, share | match badge */}
      <div className="flex items-start justify-between p-4 sm:p-5">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onPointerDown={stopCardTap}
            onClick={(e) => {
              stopCardTap(e);
              if (actionsEnabled) onReport?.(job);
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-sprout-mint hover:bg-sprout-mint-soft transition-colors"
            aria-label="Report job"
            data-testid="job-report-btn"
          >
            <Flag className="w-5 h-5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onPointerDown={stopCardTap}
            onClick={(e) => {
              stopCardTap(e);
              if (actionsEnabled) onShare?.(job);
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-sprout-mint hover:bg-sprout-mint-soft transition-colors"
            aria-label="Share job"
            data-testid="job-share-btn"
          >
            <Share2 className="w-5 h-5" strokeWidth={1.8} />
          </button>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sprout-mint text-white text-xs font-bold">
          <Zap className="w-3.5 h-3.5" fill="white" />
          {job.match_score ?? 1}
        </span>
      </div>

      {/* logo */}
      <div className="mt-1 flex justify-center">
        <CompanyLogo company={job.company} size="lg" rounded="2xl" />
      </div>

      {/* company + blurb + title */}
      <div className="mt-5 px-5 text-center sm:px-7">
        <p className="font-display font-semibold text-2xl text-white">{job.company}</p>
        <p className="mt-3 text-[15px] leading-snug text-sprout-muted line-clamp-3">
          {descriptionPreview(job)}
        </p>
      </div>

      <div className="mt-7 px-5 sm:px-7">
        <h2
          className="font-display font-black text-white text-center leading-[1.05] tracking-tight"
          style={{ fontSize: "clamp(28px, 6vw, 40px)" }}
          data-testid="job-title"
        >
          {job.title}
        </h2>
      </div>

      {/* meta: location + date */}
      <div className="mt-5 flex flex-col items-center gap-1.5 text-[15px] text-sprout-muted">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-sprout-mint" strokeWidth={1.9} />
          <span>{job.location}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-sprout-mint" strokeWidth={1.9} />
          <span>{formatPosted(job.posted_at)}</span>
        </div>
      </div>

      {/* tags */}
      <div className="mt-6 px-5 flex flex-wrap justify-center gap-2">
        <Pill icon={BarChart3}>{seniorityLabel(job)}</Pill>
        <Pill icon={workModelIcon(job.remote)}>{workModelLabel(job.remote)}</Pill>
        <Pill icon={Briefcase}>{industryFor(job)}</Pill>
        <Pill icon={Building2}>{companySize(job)}</Pill>
      </div>

      <div className="flex-1" />

      {/* footer brand + cta */}
      <div className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-white font-display font-bold text-lg">
          <Logo size={22} />
          {BRAND.NAME}
        </div>
        <div className="flex items-center gap-1.5 text-sprout-muted text-[13px]">
          Tap for details
          <Info className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function CardBack({ job }) {
  return (
    <div className="absolute inset-0 backface-hidden rotate-y-180 bg-sprout-surface border border-sprout-border rounded-[28px] overflow-hidden flex flex-col">
      <div className="overflow-y-auto no-scrollbar px-6 py-7 flex-1">
        <h2 className="font-display font-black text-white leading-tight tracking-tight" style={{ fontSize: "clamp(26px, 5.5vw, 34px)" }}>
          {job.title}
        </h2>
        <p className="mt-2 text-white text-lg">{job.company}</p>

        <div className="mt-3 space-y-1.5 text-sprout-muted text-[15px]">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-sprout-mint" />
            <span>{job.location}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-sprout-mint" />
            <span>{formatPosted(job.posted_at)}</span>
          </div>
        </div>

        <div className="my-4 border-t border-sprout-border" />

        <DescriptionSections job={job} />

        {job.match_reasons?.length > 0 && (
          <>
            <h3 className="mt-6 font-display font-bold text-white text-xl flex items-center gap-2">
              <Zap className="w-5 h-5 text-sprout-mint" /> Why this fits you
            </h3>
            <ul className="mt-2 space-y-2">
              {job.match_reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sprout-muted leading-relaxed">
                  <span className="text-sprout-mint">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {job.requirements?.length > 0 && (
          <>
            <h3 className="mt-6 font-display font-bold text-white text-xl">Required Qualifications</h3>
            <ul className="mt-2 space-y-2">
              {job.requirements.map((r, i) => (
                <li key={i} className="flex gap-2 text-sprout-muted leading-relaxed">
                  <span className="text-sprout-mint">•</span>
                  <span>{stripHtml(r)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {job.tech_stack?.length > 0 && (
          <>
            <h3 className="mt-6 font-display font-bold text-white text-xl">Tech stack</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {job.tech_stack.map((t) => (
                <span key={t} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sprout-mint-soft text-sprout-mint">{t}</span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="px-6 pb-4 flex items-center justify-between text-sprout-muted text-[13px]">
        <span className="flex items-center gap-1.5 text-white font-display font-bold">
          <Logo size={18} /> {BRAND.NAME}
        </span>
        <span className="flex items-center gap-1.5">Tap to flip back <Info className="w-4 h-4" /></span>
      </div>
    </div>
  );
}

function Card({ job, onSwipe, onReport, onShare, isTop, index }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 0, 260], [-14, 0, 14]);
  const opacity = useTransform(x, [-360, -260, 0, 260, 360], [0, 1, 1, 1, 0]);

  // Stamp opacities — Tinder convention.
  const applyOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);       // drag RIGHT → APPLY
  const skipOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);      // drag LEFT  → SKIP

  const [flipped, setFlipped] = useState(false);
  const dragRef = useRef({ dragging: false, distance: 0 });

  return (
    <motion.div
      className="absolute inset-0 touch-none select-none"
      style={{
        x: isTop ? x : 0,
        y: isTop ? y : 0,
        rotate: isTop ? rotate : 0,
        opacity: isTop ? opacity : 1,
        scale: 1 - index * 0.03,
        translateY: index * 10,
        zIndex: 10 - index,
        touchAction: flipped ? "auto" : "none",
        WebkitUserSelect: "none",
        pointerEvents: isTop ? "auto" : "none",
      }}
      drag={isTop && !flipped ? true : false}
      dragMomentum={false}
      dragConstraints={{ left: -600, right: 600, top: -240, bottom: 240 }}
      dragElastic={0.6}
      dragSnapToOrigin
      whileDrag={{ cursor: "grabbing" }}
      onDragStart={() => { dragRef.current = { dragging: true, distance: 0 }; }}
      onDrag={(_, info) => { dragRef.current.distance = Math.abs(info.offset.x) + Math.abs(info.offset.y); }}
      onDragEnd={(_, info) => {
        dragRef.current.dragging = false;
        if (info.offset.x > 140 || info.velocity.x > 700) onSwipe("apply");          // RIGHT = APPLY
        else if (info.offset.x < -140 || info.velocity.x < -700) onSwipe("skip");    // LEFT  = SKIP
      }}
      onTap={() => {
        // Framer Motion's onTap is drag-aware: it only fires if the drag distance is below its tap threshold.
        if (!isTop) return;
        if (dragRef.current.distance > 8) return;
        setFlipped((f) => !f);
      }}
      transition={{ type: "spring", stiffness: 280, damping: 28 }}
      data-testid={isTop ? "swipe-card-top" : `swipe-card-${index}`}
    >
      <motion.div
        className="relative w-full h-full preserve-3d"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 110, damping: 18 }}
        style={{ pointerEvents: flipped ? "auto" : "none" }}
      >
        <CardFront
          job={job}
          onReport={onReport}
          onShare={onShare}
          actionsEnabled={isTop}
        />
        <CardBack job={job} />

        {/* Stamps — top corners, asymmetric rotation. */}
        {isTop && (
          <>
            <motion.div
              style={{ opacity: applyOpacity }}
              className="pointer-events-none absolute top-20 left-6 px-4 py-1.5 rounded-xl border-[3px] border-sprout-mint text-sprout-mint font-display font-black text-3xl rotate-[-14deg] backdrop-blur-sm tracking-wider"
              data-testid="apply-stamp"
            >
              APPLY
            </motion.div>
            <motion.div
              style={{ opacity: skipOpacity }}
              className="pointer-events-none absolute top-20 right-6 px-4 py-1.5 rounded-xl border-[3px] border-rose-500 text-rose-500 font-display font-black text-3xl rotate-[14deg] backdrop-blur-sm tracking-wider"
              data-testid="skip-stamp"
            >
              PASS
            </motion.div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="absolute inset-0 bg-sprout-surface border border-sprout-border rounded-[28px] p-6 overflow-hidden" data-testid="skeleton-card">
      <div className="flex items-center justify-between">
        <div className="h-5 w-16 shimmer-light rounded-full" />
        <div className="h-6 w-10 shimmer-light rounded-full" />
      </div>
      <div className="mt-6 flex justify-center"><div className="h-16 w-20 shimmer-light rounded-2xl" /></div>
      <div className="mt-5 mx-auto h-6 w-32 shimmer-light rounded" />
      <div className="mt-2 mx-auto h-4 w-3/4 shimmer-light rounded" />
      <div className="mt-1 mx-auto h-4 w-1/2 shimmer-light rounded" />
      <div className="mt-8 mx-auto h-10 w-2/3 shimmer-light rounded" />
      <div className="mt-2 mx-auto h-10 w-1/2 shimmer-light rounded" />
      <div className="mt-8 flex justify-center gap-2">
        <div className="h-7 w-20 shimmer-light rounded-full" />
        <div className="h-7 w-20 shimmer-light rounded-full" />
        <div className="h-7 w-20 shimmer-light rounded-full" />
      </div>
    </div>
  );
}

export default function Swipe() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(false);
  const [appliedToday, setAppliedToday] = useState(0);
  const [target, setTarget] = useState({ role: "", location: "" });
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(() => readPersistedFilters());
  const [totalCount, setTotalCount] = useState(null);
  const [feedMeta, setFeedMeta] = useState(null);
  const [feedError, setFeedError] = useState("");
  const [reportJob, setReportJob] = useState(null);
  const fetchingRef = useRef(false);
  const filtersRef = useRef(filters);
  const pendingFiltersRef = useRef(undefined);
  const viewedJobIdsRef = useRef(new Set());

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await api.get("/profile");
      if (data) {
        setTarget({
          role: data.target_role || "",
          location: data.target_location || "",
        });
        setTargetLocationData(data.target_location_data || null);
      }
    } catch (_) {}
  }, []);

  const buildFeedParams = (f) => {
    const params = new URLSearchParams({ limit: "5", search_radius: DEFAULT_SEARCH_RADIUS });
    if (!f) return params;
    if (f.minSalary)            params.set("min_salary", String(f.minSalary));
    if (f.postedDate && f.postedDate !== "any") params.set("posted_within", f.postedDate);
    f.workLocations?.forEach((v) => params.append("work_location", v));
    f.jobTypes?.forEach((v)      => params.append("job_type", v));
    f.experience?.forEach((v)    => params.append("experience", v));
    if (f.locationsData?.length) {
      params.set("locations_json", JSON.stringify(f.locationsData));
    } else if (f.locationData) {
      params.set("locations_json", JSON.stringify([f.locationData]));
    } else {
      f.locations?.forEach((v) => params.append("location", v));
    }
    f.onlyCompanies?.forEach((v) => params.append("only_company", v));
    f.hideCompanies?.forEach((v) => params.append("hide_company", v));
    f.onlyIndustries?.forEach((v) => params.append("only_industry", v));
    f.hideIndustries?.forEach((v) => params.append("hide_industry", v));
    if (f.includeUnknownLocation === false) params.set("include_unknown_location", "false");
    if (f.includeUnknownSalary === false)   params.set("include_unknown_salary", "false");
    if (f.searchRadius) params.set("search_radius", f.searchRadius);
    if (f.onlyMyCountry) params.set("only_my_country", "true");
    return params;
  };

  const loadFeed = useCallback(async (replace = false, f = filtersRef.current) => {
    if (fetchingRef.current) {
      // queue the most recent filter change so it's not silently dropped
      pendingFiltersRef.current = { replace, f };
      return;
    }
    fetchingRef.current = true;
    setLoading(true);
    setFeedError("");
    if (replace) setJobs([]);
    try {
      const params = buildFeedParams(f);
      console.log("JOB_FEED_PARAMS", {
        params: params.toString(),
        locations: f?.locationsData || (f?.locationData ? [f.locationData] : []),
        search_radius: f?.searchRadius || DEFAULT_SEARCH_RADIUS,
        only_my_country: Boolean(f?.onlyMyCountry),
      });
      const { data } = await api.get(`/jobs/feed?${params.toString()}`, { timeout: 15000 });
      setTotalCount(typeof data.total === "number" ? data.total : null);
      setFeedMeta(data || null);
      setJobs((prev) => {
        const base = replace ? [] : prev;
        const seen = new Set(base.map((j) => j.job_id));
        const merged = [...base];
        (data.jobs || []).forEach((j) => { if (!seen.has(j.job_id)) merged.push(j); });
        return merged;
      });
    } catch (e) {
      const detail = e?.code === "ECONNABORTED"
        ? "Jobs feed is taking too long. Try refreshing or widening your filters."
        : e?.response?.data?.detail || "Failed to load jobs";
      setFeedError(typeof detail === "string" ? detail : "Failed to load jobs");
      setFeedMeta((prev) => ({
        ...(prev || {}),
        fallback_reason: typeof detail === "string" ? detail : "Failed to load jobs",
      }));
      if (replace) setJobs([]);
      toast.error(typeof detail === "string" ? detail : "Failed to load jobs");
    } finally {
      setLoading(false);
      fetchingRef.current = false;
      const pending = pendingFiltersRef.current;
      if (pending) {
        pendingFiltersRef.current = undefined;
        loadFeed(pending.replace, pending.f);
      }
    }
  }, []);

  useEffect(() => {
    loadProfile();
    const persistedFilters = readPersistedFilters();
    if (persistedFilters) {
      filtersRef.current = persistedFilters;
      setFilters(persistedFilters);
      loadFeed(true, persistedFilters);
      return;
    }
    loadFeed(true, null);
  }, [loadProfile, loadFeed]);

  const applyFilters = (f) => {
    trackEvent("filters_applied", {
      locations: f?.locations,
      locationsData: f?.locationsData,
      workLocations: f?.workLocations,
      searchRadius: f?.searchRadius,
    });
    filtersRef.current = f;
    setFilters(f);
    savePersistedFilters(f);
    setFiltersOpen(false);
    setJobs([]);
    setLoading(true);
    setTotalCount(null);
    setFeedMeta(null);
    setFeedError("");
    loadFeed(true, f);
  };

  const resetFilters = () => {
    clearPersistedFilters();
    filtersRef.current = null;
    setFilters(null);
    setFiltersOpen(false);
    setJobs([]);
    setLoading(true);
    setTotalCount(null);
    setFeedMeta(null);
    setFeedError("");
    loadFeed(true, null);
  };

  const topJob = jobs[0];

  useEffect(() => {
    trackEvent("swipe_page_view");
  }, []);

  useEffect(() => {
    if (!topJob?.job_id) return;
    if (viewedJobIdsRef.current.has(topJob.job_id)) return;
    viewedJobIdsRef.current.add(topJob.job_id);
    trackEvent("job_card_viewed", {
      job_id: topJob.job_id,
      company: topJob.company,
      ats_provider: topJob.ats_provider,
      location: topJob.location,
    });
  }, [topJob?.job_id, topJob?.company, topJob?.ats_provider, topJob?.location]);

  // intent: "apply" | "skip"
  const handleSwipe = async (intent) => {
    if (!topJob) return;
    const job = topJob;
    setJobs((prev) => prev.slice(1));
    const direction = intent === "apply" ? "right" : "left";   // backend semantic
    if (intent === "apply") {
      trackEvent("application_generation_started", {
        job_id: job.job_id,
        company: job.company,
        ats_provider: job.ats_provider,
      });
      setAppLoading(true);
      setAppliedToday((n) => n + 1);
    }
    trackEvent(intent === "apply" ? "job_swiped_right" : "job_swiped_left", {
      job_id: job.job_id,
      company: job.company,
      ats_provider: job.ats_provider,
      location: job.location,
    });
    const loadingToastId = intent === "apply"
      ? toast.loading("Generating tailored application...", {
          description: "This can take up to a minute for detailed job posts.",
        })
      : null;
    try {
      const { data } = await api.post(
        "/swipe",
        { job_id: job.job_id, direction },
        intent === "apply" ? { timeout: 180000 } : undefined,
      );
      if (intent === "apply" && data.applied) {
        trackApplicationOutcome(data, job);
        const copy = swipeSuccessCopy(data, job);
        toast.success(copy.title, {
          id: loadingToastId,
          description: copy.description,
          duration: 3500,
        });
      }
    } catch (e) {
      toast.error(swipeErrorMessage(e), loadingToastId ? { id: loadingToastId } : undefined);
    }
    finally { if (intent === "apply") setAppLoading(false); }
    if (jobs.length <= 3) loadFeed();
  };

  const handleUndo = async () => {
    try {
      const { data } = await api.post("/swipe/undo");
      if (data.ok) { toast("Undone"); loadFeed(true); }
    } catch (e) { toast.error("Nothing to undo"); }
  };

  const handleShareJob = async (job) => {
    try {
      const result = await shareJob(job);
      if (result.cancelled) return;
      if (result.method === "clipboard") toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not share this job");
    }
  };

  const dismissJob = useCallback((jobId) => {
    setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    api.post("/swipe", { job_id: jobId, direction: "left" }).catch(() => {});
    if (jobs.length <= 3) loadFeed();
  }, [jobs.length, loadFeed]);

  const handleReportSubmit = async (reason) => {
    if (!reportJob) return;
    try {
      await api.post("/jobs/report", { job_id: reportJob.job_id, reason });
    } catch (_) {
      /* demo / offline — still acknowledge */
    }
    toast.success("Thanks — we'll review this listing");
    const reportedId = reportJob.job_id;
    setReportJob(null);
    if (topJob?.job_id === reportedId) dismissJob(reportedId);
  };

  return (
    <div className="sprout h-dvh flex flex-col bg-sprout-bg text-zinc-900 overflow-hidden">
      <header
        className="mx-auto flex w-full max-w-md shrink-0 items-center gap-1 px-safe pb-2 pt-safe sm:gap-2.5 sm:px-4"
        data-testid="swipe-header"
      >
        <div className="flex shrink-0 items-center gap-0.5">
          <div className="flex items-center gap-0.5 px-0.5">
            <Zap className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" strokeWidth={2} fill="rgb(167,139,250)" />
            <span className="text-xs font-semibold text-sprout-mint sm:text-sm" data-testid="applied-today">
              {appliedToday}
            </span>
          </div>
          <button
            onClick={handleUndo}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="undo-btn"
            aria-label="Undo last swipe"
          >
            <Undo2 className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setTargetSheetOpen(true)}
          className="min-w-0 flex-1 rounded-full border border-transparent bg-white px-2 py-1 text-center shadow-sm ring-1 ring-zinc-200/80 transition-colors hover:border-violet-200 hover:bg-violet-50/50 sm:px-4 sm:py-1.5"
          data-testid="target-pill"
          aria-label="Edit target role and location"
        >
          <p className="truncate text-xs font-semibold leading-tight text-zinc-900 sm:text-sm">
            {target.role || "Set target role"}
          </p>
          <p className="truncate text-[9px] leading-tight text-zinc-500 sm:text-[11px]">
            <span className="sm:hidden">{target.location || "Anywhere"}</span>
            <span className="hidden sm:inline">{target.location || "Anywhere"} · tap to edit</span>
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => navigate("/history")}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="history-btn"
            aria-label="History"
          >
            <History className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
          </button>
          <button
            onClick={() => setFiltersOpen(true)}
            className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="filters-open-btn"
            aria-label="Open filters"
          >
            <SlidersHorizontal className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
            {hasActiveFilters(filters) && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sprout-bg bg-sprout-mint" />
            )}
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 px-4 pb-2">
        <div className="relative mx-auto h-full w-full max-w-md">
          {loading && jobs.length === 0 && <SkeletonCard />}

          {!loading && jobs.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
              data-testid="feed-empty"
            >
              <div className="w-16 h-16 rounded-2xl bg-sprout-mint-soft grid place-items-center mb-4">
                <Zap className="w-7 h-7 text-sprout-mint" />
              </div>
              <h3 className="font-display font-bold text-2xl text-white">
                {feedError
                  ? "Could not load jobs."
                  : feedMeta?.fallback_reason === "no_auto_apply_jobs_found"
                  ? "No one-swipe jobs found with these filters."
                  : "No jobs found with these filters."}
              </h3>
              <p className="mt-2 text-sprout-muted text-sm max-w-xs">
                {feedError
                  ? feedError
                  : feedMeta?.provider_rate_limited
                  ? "Job provider is temporarily rate-limited. Try again later or widen filters."
                  : feedMeta?.fallback_reason === "no_auto_apply_jobs_found"
                    ? "Try widening your distance, adding more locations, or choosing another role."
                  : feedMeta?.fallback_reason || "Try widening your search distance or changing your location."}
              </p>
              <button
                onClick={() => loadFeed(true)}
                className="mt-6 rounded-full bg-sprout-mint text-white font-semibold h-11 px-6 hover:opacity-90 transition-opacity"
                data-testid="refresh-feed-btn"
              >
                Refresh feed
              </button>
            </motion.div>
          )}

          <AnimatePresence>
            {jobs.slice(0, 3).reverse().map((j, i, arr) => {
              const idx = arr.length - 1 - i;
              return (
                <Card
                  key={j.job_id}
                  job={j}
                  onSwipe={handleSwipe}
                  onReport={setReportJob}
                  onShare={handleShareJob}
                  isTop={idx === 0}
                  index={idx}
                />
              );
            })}
          </AnimatePresence>

          {topJob ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center gap-8 sm:gap-14"
              style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => handleSwipe("skip")}
                disabled={!topJob || appLoading}
                className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full border-2 border-rose-500/70 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-colors hover:border-rose-500"
                aria-label="Pass"
                data-testid="skip-btn"
              >
                <X className="h-6 w-6 text-rose-500" strokeWidth={2.5} />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => handleSwipe("apply")}
                disabled={!topJob || appLoading}
                className="pointer-events-auto grid h-16 w-16 place-items-center rounded-full gradient-linkedin shadow-[0_8px_28px_rgba(124,58,237,0.45)] transition-opacity hover:opacity-90"
                aria-label="Apply"
                data-testid="apply-btn"
              >
                {appLoading
                  ? <Loader2 className="h-6 w-6 animate-spin text-white" />
                  : <Heart className="h-6 w-6 fill-white text-white" />
                }
              </motion.button>
            </div>
          ) : null}
        </div>
      </div>

      <TargetSearchSheet
        open={targetSheetOpen}
        initialRole={target.role}
        initialLocation={target.location}
        initialLocationData={targetLocationData}
        onClose={() => setTargetSheetOpen(false)}
        onSaved={({ role, location, locationData }) => {
          setTarget({ role, location });
          setTargetLocationData(locationData);
          loadFeed(true, filtersRef.current);
        }}
      />

      <FiltersModal
        open={filtersOpen}
        initialFilters={filters}
        totalCount={totalCount}
        onApply={applyFilters}
        onReset={resetFilters}
        onClose={() => setFiltersOpen(false)}
      />

      <ReportJobSheet
        open={Boolean(reportJob)}
        job={reportJob}
        onClose={() => setReportJob(null)}
        onSubmit={handleReportSubmit}
      />
    </div>
  );
}
