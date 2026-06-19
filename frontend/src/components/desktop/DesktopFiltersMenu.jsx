import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  TrendingUp,
  X,
} from "lucide-react";
import {
  countActiveFilterGroups,
  formatMinSalary,
  mergeFilters,
  toggleFilterArray,
} from "../../lib/jobFilters";
import {
  getDateOptions,
  getExperienceOptions,
  getFilterPanels,
  getJobTypeOptions,
  getWorkLocationOptions,
} from "../../lib/appUi";
import { useAppLocale } from "../../context/AppLocaleContext";

const PANEL_ICONS = {
  postedDate: Calendar,
  workLocation: Home,
  experience: TrendingUp,
  jobType: Briefcase,
  salary: DollarSign,
  company: Building2,
  industry: Factory,
};

const SUBMENU_GAP = 6;
const MAIN_MENU_WIDTH = 224;
const VIEWPORT_PADDING = 12;

function submenuWidthFor(panel) {
  return panel === "company" || panel === "industry" ? 300 : 220;
}

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

function ListAddSection({ title, placeholder, values, onAdd, onRemove, testId, isDark, addLabel, removeLabel }) {
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
          {addLabel}
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
                aria-label={typeof removeLabel === "function" ? removeLabel(value) : removeLabel}
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
  themeMode = "light",
  onOpenChange,
}) {
  const isDark = themeMode === "dark";
  const { t } = useAppLocale();
  const panels = getFilterPanels(t).map((panel) => ({
    ...panel,
    icon: PANEL_ICONS[panel.id],
  }));
  const anchorRef = useRef(null);
  const flyoutRef = useRef(null);
  const salaryTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [flyoutPos, setFlyoutPos] = useState(null);
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

  const updateFlyoutPosition = useCallback(() => {
    if (!open || !anchorRef.current) return;

    const anchor = anchorRef.current.getBoundingClientRect();
    const submenuWidth = activePanel ? submenuWidthFor(activePanel) + SUBMENU_GAP : 0;
    const totalWidth = MAIN_MENU_WIDTH + submenuWidth;

    let left = anchor.left;
    if (left + totalWidth > window.innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - totalWidth);
    }

    let top = anchor.bottom + 8;
    const flyoutHeight = flyoutRef.current?.offsetHeight ?? 0;
    if (flyoutHeight > 0 && top + flyoutHeight > window.innerHeight - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, anchor.top - 8 - flyoutHeight);
    }

    setFlyoutPos({ left, top });
  }, [activePanel, open]);

  useLayoutEffect(() => {
    updateFlyoutPosition();
  }, [updateFlyoutPosition]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("resize", updateFlyoutPosition);
    window.addEventListener("scroll", updateFlyoutPosition, true);
    return () => {
      window.removeEventListener("resize", updateFlyoutPosition);
      window.removeEventListener("scroll", updateFlyoutPosition, true);
    };
  }, [open, updateFlyoutPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (anchorRef.current?.contains(event.target)) return;
      if (flyoutRef.current?.contains(event.target)) return;
      setActivePanel(null);
      setFlyoutPos(null);
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setActivePanel(null);
        setFlyoutPos(null);
        setOpen(false);
      }
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
            {getDateOptions(t).map((option) => (
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
            {getWorkLocationOptions(t).map(({ value, label }) => (
              <SubmenuOption
                key={value}
                isDark={isDark}
                multi
                active={f.workLocations.includes(value)}
                label={label}
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
            {getExperienceOptions(t).map(({ value, label }) => (
              <SubmenuOption
                key={value}
                isDark={isDark}
                multi
                active={f.experience.includes(value)}
                label={label}
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
            {getJobTypeOptions(t).map(({ value, label }) => (
              <SubmenuOption
                key={value}
                isDark={isDark}
                multi
                active={f.jobTypes.includes(value)}
                label={label}
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
              {t("filters.minimum")}
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
              title={t("filters.onlyCompanies")}
              placeholder={t("filters.companyPlaceholder")}
              addLabel={t("common.add")}
              removeLabel={(value) => t("filters.removeValue", { value })}
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
              title={t("filters.hideCompanies")}
              placeholder={t("filters.companyPlaceholder")}
              addLabel={t("common.add")}
              removeLabel={(value) => t("filters.removeValue", { value })}
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
              title={t("filters.onlyIndustries")}
              placeholder={t("filters.industryPlaceholder")}
              addLabel={t("common.add")}
              removeLabel={(value) => t("filters.removeValue", { value })}
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
              title={t("filters.hideIndustries")}
              placeholder={t("filters.industryPlaceholder")}
              addLabel={t("common.add")}
              removeLabel={(value) => t("filters.removeValue", { value })}
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

  const submenuWidth = activePanel ? submenuWidthFor(activePanel) : 0;

  const toggleOpen = () => {
    setOpen((current) => {
      if (current) {
        setActivePanel(null);
        setFlyoutPos(null);
        return false;
      }
      setActivePanel(null);
      return true;
    });
  };

  return (
    <div className="relative" ref={anchorRef} data-testid="desktop-filters-menu">
      <button
        type="button"
        onClick={toggleOpen}
        className={`relative inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium ${
          isDark
            ? "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-600"
            : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300"
        }`}
        data-testid="desktop-filters-open"
        aria-expanded={open}
      >
        <SlidersHorizontal className="h-4 w-4" />
        {t("filters.title")}
        {activeCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={flyoutRef}
          className="fixed z-50 flex items-start"
          style={{
            left: flyoutPos?.left ?? 0,
            top: flyoutPos?.top ?? 0,
            visibility: flyoutPos ? "visible" : "hidden",
          }}
        >
          <div className={`w-56 rounded-xl border p-1.5 ${menuShell}`}>
            {panels.map(({ id, label, icon: Icon }) => (
              <FlyoutRow
                key={id}
                isDark={isDark}
                active={activePanel === id}
                onMouseEnter={() => setActivePanel(id)}
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
              <span className="min-w-0 flex-1 text-xs leading-snug">{t("filters.includeUnknownLocation")}</span>
            </FlyoutRow>
            <FlyoutRow
              isDark={isDark}
              active={false}
              onClick={() => patch({ includeUnknownSalary: !f.includeUnknownSalary })}
              testId="desktop-filters-unknown-salary"
            >
              <Check className={`h-4 w-4 shrink-0 ${f.includeUnknownSalary ? "text-violet-400" : "text-transparent"}`} />
              <span className="min-w-0 flex-1 text-xs leading-snug">{t("filters.includeUnknownSalary")}</span>
            </FlyoutRow>

          </div>

          {activePanel ? (
            <div
              className={`ml-1.5 rounded-xl border ${submenuShell}`}
              style={{ width: submenuWidth }}
              data-testid="desktop-filters-submenu"
            >
              {renderSubmenu()}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
