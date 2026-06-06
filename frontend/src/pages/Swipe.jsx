import { useEffect, useState, useCallback, useRef } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  Zap, Undo2, History, SlidersHorizontal, Flag, Share2, MapPin, Calendar,
  Briefcase, Building2, BarChart3, Laptop, Info,
} from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import FiltersModal from "../components/FiltersModal";
import { BRAND } from "../lib/brand";

const DEFAULT_SEARCH_RADIUS = "50km";

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

const initial = (s) => (s || "?").trim().charAt(0).toUpperCase();

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

function CardFront({ job }) {
  return (
    <div className="absolute inset-0 backface-hidden bg-sprout-surface border border-sprout-border rounded-[28px] overflow-hidden flex flex-col">
      {/* top bar: flag, share | match badge */}
      <div className="flex items-start justify-between p-5">
        <div className="flex items-center gap-3">
          <Flag className="w-5 h-5 text-sprout-mint" strokeWidth={1.8} />
          <Share2 className="w-5 h-5 text-sprout-mint" strokeWidth={1.8} />
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sprout-mint text-white text-xs font-bold">
          <Zap className="w-3.5 h-3.5" fill="white" />
          {job.match_score ?? 1}
        </span>
      </div>

      {/* logo */}
      <div className="flex justify-center mt-1">
        <div className="w-20 h-16 rounded-2xl bg-white grid place-items-center font-display font-black text-2xl text-zinc-900">
          {initial(job.company)}
        </div>
      </div>

      {/* company + blurb + title */}
      <div className="px-7 mt-5 text-center">
        <p className="font-display font-semibold text-2xl text-white">{job.company}</p>
        <p className="mt-3 text-[15px] leading-snug text-sprout-muted line-clamp-3">
          {descriptionPreview(job)}
        </p>
      </div>

      <div className="px-7 mt-7">
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

function Card({ job, onSwipe, isTop, index }) {
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
        <CardFront job={job} />
        <CardBack job={job} />

        {/* Stamps — top corners, asymmetric rotation. */}
        {isTop && (
          <>
            <motion.div
              style={{ opacity: applyOpacity }}
              className="pointer-events-none absolute top-20 left-6 px-4 py-1.5 rounded-xl border-[3px] border-sprout-mint text-sprout-mint font-display font-black text-3xl rotate-[-14deg] backdrop-blur-sm tracking-wider"
              data-testid="apply-stamp"
            >
              SEND
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
        <div className="h-5 w-16 shimmer-dark rounded-full" />
        <div className="h-6 w-10 shimmer-dark rounded-full" />
      </div>
      <div className="mt-6 flex justify-center"><div className="h-16 w-20 shimmer-dark rounded-2xl" /></div>
      <div className="mt-5 mx-auto h-6 w-32 shimmer-dark rounded" />
      <div className="mt-2 mx-auto h-4 w-3/4 shimmer-dark rounded" />
      <div className="mt-1 mx-auto h-4 w-1/2 shimmer-dark rounded" />
      <div className="mt-8 mx-auto h-10 w-2/3 shimmer-dark rounded" />
      <div className="mt-2 mx-auto h-10 w-1/2 shimmer-dark rounded" />
      <div className="mt-8 flex justify-center gap-2">
        <div className="h-7 w-20 shimmer-dark rounded-full" />
        <div className="h-7 w-20 shimmer-dark rounded-full" />
        <div className="h-7 w-20 shimmer-dark rounded-full" />
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(null);
  const [totalCount, setTotalCount] = useState(null);
  const [feedMeta, setFeedMeta] = useState(null);
  const [feedError, setFeedError] = useState("");
  const fetchingRef = useRef(false);
  const filtersRef = useRef(null);
  const pendingFiltersRef = useRef(undefined);

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await api.get("/profile");
      if (data) setTarget({ role: data.target_role || "", location: data.target_location || "" });
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

  useEffect(() => { loadProfile(); loadFeed(true, null); }, [loadProfile, loadFeed]);

  const applyFilters = (f) => {
    filtersRef.current = f;
    setFilters(f);
    setFiltersOpen(false);
    loadFeed(true, f);
  };

  const topJob = jobs[0];

  // intent: "apply" | "skip"
  const handleSwipe = async (intent) => {
    if (!topJob) return;
    const job = topJob;
    setJobs((prev) => prev.slice(1));
    const direction = intent === "apply" ? "right" : "left";   // backend semantic
    if (intent === "apply") {
      setAppLoading(true);
      setAppliedToday((n) => n + 1);
    }
    try {
      const { data } = await api.post("/swipe", { job_id: job.job_id, direction });
      if (intent === "apply" && data.applied) {
        toast.success(`Application package generated for ${job.company}`, {
          description: "CV and cover letter are ready. Not submitted yet.",
          duration: 3500,
        });
      }
    } catch (e) { toast.error("Swipe failed"); }
    finally { if (intent === "apply") setAppLoading(false); }
    if (jobs.length <= 3) loadFeed();
  };

  const handleUndo = async () => {
    try {
      const { data } = await api.post("/swipe/undo");
      if (data.ok) { toast("Undone"); loadFeed(true); }
    } catch (e) { toast.error("Nothing to undo"); }
  };

  const headerLabel = target.role
    ? `${target.role}${target.location ? ` · ${target.location}` : ""}`
    : "Browsing all roles";

  return (
    <div className="sprout h-dvh flex flex-col bg-sprout-bg text-white overflow-hidden">
      <header className="px-4 pt-5 pb-3 flex items-center gap-3 max-w-md mx-auto w-full" data-testid="swipe-header">
        <div className="flex items-center gap-1.5">
          <Zap className="w-5 h-5 text-sprout-mint" strokeWidth={2} fill="rgb(167,139,250)" />
          <span className="text-sprout-mint font-semibold text-sm" data-testid="applied-today">{appliedToday}</span>
        </div>
        <button onClick={handleUndo} className="w-9 h-9 grid place-items-center rounded-full hover:bg-sprout-surface" data-testid="undo-btn" aria-label="Undo last swipe">
          <Undo2 className="w-5 h-5 text-sprout-mint" />
        </button>
        <div className="flex-1 flex justify-center">
          <div className="px-4 py-1.5 rounded-full bg-sprout-surface text-center max-w-[220px] truncate" data-testid="target-pill">
            <p className="font-semibold text-white text-sm leading-tight truncate">{target.role || "Set target role"}</p>
            <p className="text-[11px] text-sprout-muted leading-tight truncate">{target.location || "Anywhere"} · auto-match</p>
          </div>
        </div>
        <button
          onClick={() => navigate("/history")}
          className="w-9 h-9 grid place-items-center rounded-full hover:bg-sprout-surface"
          data-testid="history-btn"
          aria-label="History"
        >
          <History className="w-5 h-5 text-sprout-mint" />
        </button>
        <button
          onClick={() => setFiltersOpen(true)}
          className="relative w-9 h-9 grid place-items-center rounded-full hover:bg-sprout-surface"
          data-testid="filters-open-btn"
        >
          <SlidersHorizontal className="w-5 h-5 text-sprout-mint" />
          {filters && Object.values(filters).some((v) =>
            Array.isArray(v) ? v.length > 0 : (typeof v === "number" ? v > 0 : false)
          ) && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-sprout-mint border-2 border-sprout-bg" />
          )}
        </button>
      </header>

      <div className="flex-1 relative px-4 pb-24">
        <div className="relative w-full max-w-md mx-auto h-full">
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
              return <Card key={j.job_id} job={j} onSwipe={handleSwipe} isTop={idx === 0} index={idx} />;
            })}
          </AnimatePresence>
        </div>
      </div>

      {topJob && (
        <div className="absolute bottom-[100px] inset-x-0 flex items-center justify-center pointer-events-none z-10">
          <div className="pointer-events-auto px-4 py-1.5 rounded-full bg-sprout-surface/80 backdrop-blur-md border border-sprout-border text-[11px] text-sprout-muted font-medium tracking-wide" data-testid="swipe-hint">
            ← Pass · Tap card for details · Send →
          </div>
        </div>
      )}

      <FiltersModal
        open={filtersOpen}
        initialFilters={filters}
        totalCount={totalCount}
        onApply={applyFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </div>
  );
}
