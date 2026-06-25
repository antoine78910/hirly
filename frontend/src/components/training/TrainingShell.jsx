import { useEffect } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  GraduationCap, LayoutDashboard, BookOpen, Sparkles, ArrowLeft, ChevronDown,
} from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { useTrainingLocale } from "../../context/TrainingLocaleContext";
import { parseTrainingLocale, trainingHubPath, trainingPath } from "../../lib/trainingRoutes";

export function useTrainingPageMode() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const app = document.querySelector(".App");

    html.classList.add("training-page-active", "document-scroll");
    body.classList.add("training-page", "document-scroll");
    root?.classList.add("document-scroll");
    app?.classList.add("document-scroll");
    html.classList.remove("app-shell-locked");
    body.classList.remove("app-shell-locked");

    return () => {
      html.classList.remove("training-page-active", "document-scroll", "app-shell-locked");
      body.classList.remove("training-page", "document-scroll", "app-shell-locked");
      root?.classList.remove("document-scroll");
      app?.classList.remove("document-scroll");
    };
  }, []);
}

export function TrainingTopBar({ actions, backTo, progressPct = null, moduleStepper = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeLocale = parseTrainingLocale(location.pathname);
  const { lang, t } = useTrainingLocale();
  const homePath = trainingHubPath(routeLocale);

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {backTo ? (
            <button
              type="button"
              onClick={() => navigate(backTo)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigate(homePath)}
            className="flex min-w-0 items-center gap-2"
          >
            <Logo size={24} />
            <span className="truncate text-sm font-semibold text-zinc-800">
              {BRAND.NAME} {t("academy")}
            </span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {moduleStepper}
          {actions}
          <button
            type="button"
            onClick={() => navigate("/swipe")}
            className="hidden rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-white sm:inline-flex"
          >
            {t("backToApp")}
          </button>
        </div>
      </div>

      {/* Thin progress bar at the bottom edge of the header */}
      {progressPct != null && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-zinc-100">
          <div
            className="h-full bg-gradient-to-r from-violet-500 via-violet-400 to-indigo-400 transition-[width] duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
            aria-hidden
          />
        </div>
      )}
    </header>
  );
}

export function TrainingHero({ title, subtitle, hint }) {
  return (
    <section className="border-b border-zinc-200/80 bg-white px-4 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl md:text-6xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-500 sm:text-lg">
            {subtitle}
          </p>
        ) : null}
        {hint ? (
          <p className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400">
            {hint}
            <ChevronDown className="h-4 w-4 animate-bounce" />
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default function TrainingShell({
  title,
  subtitle,
  actions,
  children,
  showSidebar = true,
  isCreator = false,
  hero,
  progressPct = null,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const routeLocale = parseTrainingLocale(location.pathname);
  const { lang, t } = useTrainingLocale();
  const hubPath = trainingHubPath(routeLocale);
  const learningTab = searchParams.get("tab") === "learning";

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <TrainingTopBar actions={actions} progressPct={progressPct} />
      {hero}

        {showSidebar ? (
          <div className="mx-auto flex max-w-6xl gap-10 px-4 py-8 sm:px-8">
            <aside className="hidden w-52 shrink-0 lg:block">
              <nav className="sticky top-20 space-y-0.5">
                <button
                  type="button"
                  onClick={() => navigate(hubPath)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium ${
                    !learningTab ? "bg-zinc-200/70 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  <BookOpen className="h-4 w-4 opacity-70" />
                  {t("catalog")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`${hubPath}?tab=learning`)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium ${
                    learningTab ? "bg-zinc-200/70 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  <Sparkles className="h-4 w-4 opacity-70" />
                  {t("myLearning")}
                </button>
                {isCreator ? (
                  <NavLink
                    to={trainingPath(routeLocale || lang, "creator")}
                    className={({ isActive }) => `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium ${
                      isActive ? "bg-zinc-200/70 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    <LayoutDashboard className="h-4 w-4 opacity-70" />
                    {t("creatorStudio")}
                  </NavLink>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigate("/swipe")}
                  className="mt-6 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-500 hover:bg-zinc-100"
                >
                  <GraduationCap className="h-4 w-4" />
                  {t("returnToBrand", { brand: BRAND.NAME })}
                </button>
              </nav>
            </aside>

            <main className="min-w-0 flex-1">
              {title && !hero ? (
                <div className="mb-8">
                  <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900">
                    {title}
                  </h1>
                  {subtitle ? <p className="mt-2 max-w-2xl text-zinc-500">{subtitle}</p> : null}
                </div>
              ) : null}
              {children}
            </main>
          </div>
        ) : (
          children
        )}
    </div>
  );
}
