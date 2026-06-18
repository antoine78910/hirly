import { useCallback, useEffect, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronRight,
  DollarSign,
  Factory,
  Home,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import {
  DATE_OPTIONS,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LABELS,
  JOB_LABELS,
  JOB_TYPES,
  WORK_LABELS,
  WORK_LOCATIONS,
  countActiveFilterGroups,
  formatMinSalary,
  mergeFilters,
  toggleFilterArray,
} from "../../lib/jobFilters";

const PANELS = [
  { id: "postedDate", label: "Posted Date", icon: Calendar },
  { id: "workLocation", label: "Work Location", icon: Home },
  { id: "experience", label: "Experience", icon: TrendingUp },
  { id: "jobType", label: "Job Type", icon: Briefcase },
  { id: "salary", label: "Salary", icon: DollarSign },
  { id: "company", label: "Company", icon: Building2 },
  { id: "industry", label: "Industry", icon: Factory },
];

function FlyoutRow({ active, children, onClick, onMouseEnter, testId, isDark }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      data-testid={testId}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
        active
          ? isDark ? "bg-zinc-800 text-white" : "bg-violet-50 text-violet-900"
          : isDark ? "text-zinc-200 hover:bg-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

function SubmenuOption({ active, label, onClick, testId, multi = false, isDark }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
        active && !multi
          ? isDark ? "bg-zinc-800 text-white" : "bg-violet-50 text-violet-900"
          : isDark ? "text-zinc-200 hover:bg-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      <span>{label}</span>
      {active && !multi ? <span className={`h-2 w-2 rounded-full ${isDark ? "bg-white" : "bg-violet-600"}`} /> : null}
      {active && multi ? <Check className="h-4 w-4 text-violet-500" /> : null}
    </button>
  );
}

function ListAddSection({ title, placeholder, values, onAdd, onRemove, testId, isDark }) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const next = draft.trim();
    if (!next) return;
    onAdd(next);
    setDraft("");
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="px-1 text-xs font-medium text-zinc-400">{title}</p>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className={`h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none ${
            isDark
              ? "border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-500 focus:border-zinc-500"
              : "border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-violet-300"
          }`}
        />
        <button
          type="button"
          onClick={submit}
          className={`h-9 shrink-0 rounded-lg px-3 text-sm font-medium ${
            isDark ? "bg-zinc-800 text-white hover:bg-zinc-700" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
          }`}
        >
          Add
        </button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                isDark ? "bg-zinc-800 text-zinc-200" : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {value}
              <button
                type="button"
                onClick={() => onRemove(value)}
                className="text-zinc-400 hover:text-white"
                aria-label={`Remove ${value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DesktopFiltersMenu({
  filters,
  onFiltersChange,
  onOpenTarget,
  themeMode = "light",
  onOpenChange,
}) {
  const isDark = themeMode === "dark";
  const anchorRef = useRef(null);
  const salaryTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState("postedDate");
  const f = mergeFilters(filters);
  const activeCount = countActiveFilterGroups(f);
  const [salaryDraft, setSalaryDraft] = useState(f.minSalary);

  useEffect(() => {
    setSalaryDraft(f.minSalary);
  }, [f.minSalary]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const patch = useCallback((partial) => {
    onFiltersChange?.(mergeFilters({ ...f, ...partial }));
  }, [f, onFiltersChange]);

  const patchSalary = useCallback((minSalary) => {
    if (salaryTimerRef.current) clearTimeout(salaryTimerRef.current);
    salaryTimerRef.current = setTimeout(() => {
      onFiltersChange?.(mergeFilters({ ...f, minSalary }));
    }, 300);
  }, [f, onFiltersChange]);

  useEffect(() => () => {
    if (salaryTimerRef.current) clearTimeout(salaryTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (anchorRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menuShell = isDark
    ? "border-zinc-800 bg-zinc-950 text-white shadow-2xl shadow-black/50"
    : "border-zinc-200 bg-white text-zinc-900 shadow-xl shadow-zinc-300/40";

  const submenuShell = isDark
    ? "border-zinc-800 bg-zinc-950 text-white shadow-2xl shadow-black/50"
    : "border-zinc-200 bg-white text-zinc-900 shadow-xl shadow-zinc-300/40";

  const renderSubmenu = () => {
    switch (activePanel) {
      case "postedDate":
        return (
          <div className="space-y-0.5 p-1.5">
            {DATE_OPTIONS.map((option) => (
              <SubmenuOption
                key={option.value}
                isDark={isDark}
                active={f.postedDate === option.value}
                label={option.label}
                onClick={() => patch({ postedDate: option.value })}
                testId={`desktop-filters-date-${option.value}`}
              />
            ))}
          </div>
        );
      case "workLocation":
        return (
          <div className="space-y-0.5 p-1.5">
            {WORK_LOCATIONS.map((value) => (
              <SubmenuOption
                key={value}
                isDark={isDark}
                multi
                active={f.workLocations.includes(value)}
                label={WORK_LABELS[value]}
                onClick={() => patch({
                  workLocations: toggleFilterArray(f.workLocations, value),
                })}
                testId={`desktop-filters-work-${value}`}
              />
            ))}
          </div>
        );
      case "experience":
        return (
          <div className="space-y-0.5 p-1.5">
            {EXPERIENCE_LEVELS.map((value) => (
              <SubmenuOption
                key={value}
                isDark={isDark}
                multi
                active={f.experience.includes(value)}
                label={EXPERIENCE_LABELS[value]}
                onClick={() => patch({
                  experience: toggleFilterArray(f.experience, value),
                })}
                testId={`desktop-filters-exp-${value}`}
              />
            ))}
          </div>
        );
      case "jobType":
        return (
          <div className="space-y-0.5 p-1.5">
            {JOB_TYPES.map((value) => (
              <SubmenuOption
                key={value}
                isDark={isDark}
                multi
                active={f.jobTypes.includes(value)}
                label={JOB_LABELS[value]}
                onClick={() => patch({
                  jobTypes: toggleFilterArray(f.jobTypes, value),
                })}
                testId={`desktop-filters-job-${value}`}
              />
            ))}
          </div>
        );
      case "salary":
        return (
          <div className="space-y-3 p-3">
            <p className={`text-sm ${isDark ? "text-zinc-300" : "text-zinc-600"}`}>
              Minimum:
              {" "}
              <span className={`font-semibold ${isDark ? "text-white" : "text-zinc-900"}`}>
                {formatMinSalary(salaryDraft)}
              </span>
            </p>
            <input
              type="range"
              min="0"
              max="250000"
              step="5000"
              value={salaryDraft}
              onChange={(e) => {
                const minSalary = Number(e.target.value);
                setSalaryDraft(minSalary);
                patchSalary(minSalary);
              }}
              className="w-full accent-violet-500"
              data-testid="desktop-filters-salary-slider"
            />
            <div className={`flex justify-between text-xs ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
              <span>$0</span>
              <span>$250k</span>
            </div>
          </div>
        );
      case "company":
        return (
          <div className="space-y-4 p-3">
            <ListAddSection
              isDark={isDark}
              title="Only show jobs from"
              placeholder="Company name"
              values={f.onlyCompanies}
              onAdd={(value) => patch({
                onlyCompanies: [...new Set([...f.onlyCompanies, value])],
              })}
              onRemove={(value) => patch({
                hideCompanies: f.hideCompanies,
                onlyCompanies: f.onlyCompanies.filter((item) => item !== value),
              })}
              testId="desktop-filters-only-companies"
            />
            <div className={`h-px ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
            <ListAddSection
              isDark={isDark}
              title="Hide jobs from"
              placeholder="Company name"
              values={f.hideCompanies}
              onAdd={(value) => patch({
                hideCompanies: [...new Set([...f.hideCompanies, value])],
              })}
              onRemove={(value) => patch({
                onlyCompanies: f.onlyCompanies,
                hideCompanies: f.hideCompanies.filter((item) => item !== value),
              })}
              testId="desktop-filters-hide-companies"
            />
          </div>
        );
      case "industry":
        return (
          <div className="space-y-4 p-3">
            <ListAddSection
              isDark={isDark}
              title="Only show jobs in"
              placeholder="Industry name"
              values={f.onlyIndustries}
              onAdd={(value) => patch({
                onlyIndustries: [...new Set([...f.onlyIndustries, value])],
              })}
              onRemove={(value) => patch({
                hideIndustries: f.hideIndustries,
                onlyIndustries: f.onlyIndustries.filter((item) => item !== value),
              })}
              testId="desktop-filters-only-industries"
            />
            <div className={`h-px ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />
            <ListAddSection
              isDark={isDark}
              title="Hide jobs in"
              placeholder="Industry name"
              values={f.hideIndustries}
              onAdd={(value) => patch({
                hideIndustries: [...new Set([...f.hideIndustries, value])],
              })}
              onRemove={(value) => patch({
                onlyIndustries: f.onlyIndustries,
                hideIndustries: f.hideIndustries.filter((item) => item !== value),
              })}
              testId="desktop-filters-hide-industries"
            />
          </div>
        );
      default:
        return null;
    }
  };

  const submenuWidth = activePanel === "company" || activePanel === "industry" ? 300 : 220;

  return (
    <div className="relative" ref={anchorRef} data-testid="desktop-filters-menu">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`relative inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${
          isDark
            ? "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-600"
            : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300"
        }`}
        data-testid="desktop-filters-open"
        aria-expanded={open}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {activeCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 flex items-start">
          <div className={`w-56 rounded-xl border p-1.5 ${menuShell}`}>
            {PANELS.map(({ id, label, icon: Icon }) => (
              <FlyoutRow
                key={id}
                isDark={isDark}
                active={activePanel === id}
                onMouseEnter={() => setActivePanel(id)}
                onClick={() => setActivePanel(id)}
                testId={`desktop-filters-panel-${id}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
              </FlyoutRow>
            ))}

            <div className={`my-1.5 h-px ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />

            <FlyoutRow
              isDark={isDark}
              active={false}
              onClick={() => patch({ includeUnknownLocation: !f.includeUnknownLocation })}
              testId="desktop-filters-unknown-location"
            >
              <Check className={`h-4 w-4 shrink-0 ${f.includeUnknownLocation ? "text-violet-400" : "text-transparent"}`} />
              <span className="min-w-0 flex-1 text-xs leading-snug">Include unknown work location</span>
            </FlyoutRow>
            <FlyoutRow
              isDark={isDark}
              active={false}
              onClick={() => patch({ includeUnknownSalary: !f.includeUnknownSalary })}
              testId="desktop-filters-unknown-salary"
            >
              <Check className={`h-4 w-4 shrink-0 ${f.includeUnknownSalary ? "text-violet-400" : "text-transparent"}`} />
              <span className="min-w-0 flex-1 text-xs leading-snug">Include unknown salary</span>
            </FlyoutRow>

            <div className={`my-1.5 h-px ${isDark ? "bg-zinc-800" : "bg-zinc-200"}`} />

            <FlyoutRow
              isDark={isDark}
              active={false}
              onClick={() => {
                setOpen(false);
                onOpenTarget?.();
              }}
              testId="desktop-filters-describe-search"
            >
              <Sparkles className="h-4 w-4 shrink-0 text-violet-400" />
              <span className="min-w-0 flex-1">Describe your search</span>
            </FlyoutRow>
          </div>

          <div
            className={`ml-1.5 rounded-xl border ${submenuShell}`}
            style={{ width: submenuWidth }}
            data-testid="desktop-filters-submenu"
          >
            {renderSubmenu()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
