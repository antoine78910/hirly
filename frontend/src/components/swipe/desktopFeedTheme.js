export const DESKTOP_THEME_STORAGE_KEY = "hirly.desktop.theme";

export const DESKTOP_THEMES = {
  light: {
    root: "bg-zinc-50 text-zinc-900",
    sidebar: "border-zinc-200 bg-white",
    accountBtn: "text-zinc-700 hover:bg-zinc-100",
    sectionLabel: "text-zinc-400",
    navActive: "bg-violet-50 text-violet-700",
    navIdle: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
    supportBtn: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
    header: "border-zinc-200",
    headerLink: "text-zinc-500 hover:text-zinc-900",
    iconBtn: "text-zinc-500 hover:bg-zinc-100",
    iconBtnActive: "bg-violet-50 text-violet-600",
    searchBar: "border-zinc-200",
    field: "border-zinc-200 bg-white hover:border-zinc-300",
    fieldText: "text-zinc-900",
    fieldPlaceholder: "text-zinc-400",
    select: "border-zinc-200 bg-white text-zinc-900",
    filterBtn: "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300",
    describeBtn: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    actionBtn: "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
    actionKbd: "border-zinc-200 bg-zinc-100 text-zinc-500",
    applyBtn: "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100",
    applyKbd: "border-violet-200 bg-violet-100 text-violet-600",
    skeleton: "border-zinc-200 bg-white",
    skeletonBar: "bg-zinc-200",
    emptyTitle: "text-zinc-900",
    card: "border-zinc-200 bg-white shadow-lg shadow-zinc-200/60",
    cardHeader: "border-zinc-200",
    cardTitle: "text-zinc-900",
    cardCompany: "text-zinc-600",
    cardMeta: "text-zinc-500",
    cardBody: "text-zinc-600 border-zinc-200",
    cardAbout: "border-zinc-200 bg-zinc-50",
    cardAboutTitle: "text-zinc-900",
    cardAboutBody: "text-zinc-600",
    cardSection: "border-zinc-200",
    cardBadge: "bg-zinc-100 text-zinc-700",
    tag: "border-zinc-200 bg-zinc-100 text-zinc-700",
    matchBadge: "bg-violet-100 text-violet-700",
    actionIcon: "text-zinc-500 hover:bg-zinc-100 hover:text-violet-600",
  },
  dark: {
    root: "bg-zinc-950 text-zinc-100",
    sidebar: "border-zinc-800 bg-zinc-950",
    accountBtn: "text-zinc-300 hover:bg-zinc-900",
    sectionLabel: "text-zinc-500",
    navActive: "bg-zinc-800 text-white",
    navIdle: "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
    supportBtn: "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
    header: "border-zinc-800",
    headerLink: "text-zinc-400 hover:text-white",
    iconBtn: "text-zinc-400 hover:bg-zinc-900",
    iconBtnActive: "bg-zinc-800 text-violet-300",
    searchBar: "border-zinc-800",
    field: "border-zinc-700 bg-zinc-900 hover:border-zinc-600",
    fieldText: "text-white",
    fieldPlaceholder: "text-zinc-500",
    select: "border-zinc-700 bg-zinc-900 text-white",
    filterBtn: "border-zinc-700 bg-zinc-900 text-white hover:border-zinc-600",
    describeBtn: "border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15",
    actionBtn: "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-600",
    actionKbd: "border-zinc-700 bg-zinc-800 text-zinc-500",
    applyBtn: "border-violet-500/40 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25",
    applyKbd: "border-violet-500/30 bg-violet-500/20 text-violet-200",
    skeleton: "border-zinc-800 bg-zinc-900",
    skeletonBar: "bg-zinc-800",
    emptyTitle: "text-white",
    card: "border-zinc-800 bg-zinc-900 shadow-xl shadow-black/30",
    cardHeader: "border-zinc-800",
    cardTitle: "text-white",
    cardCompany: "text-zinc-300",
    cardMeta: "text-zinc-400",
    cardBody: "text-zinc-300 border-zinc-800",
    cardAbout: "border-zinc-800 bg-zinc-950/80",
    cardAboutTitle: "text-white",
    cardAboutBody: "text-zinc-400",
    cardSection: "border-zinc-800",
    cardBadge: "bg-zinc-800 text-zinc-200",
    tag: "border-zinc-700 bg-zinc-800/80 text-zinc-200",
    matchBadge: "bg-violet-500/20 text-violet-200",
    actionIcon: "text-zinc-400 hover:bg-zinc-800 hover:text-violet-300",
  },
};

export function readDesktopTheme() {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(DESKTOP_THEME_STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch (_) {
    return "light";
  }
}

export function saveDesktopTheme(theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent("desktop-theme-change", { detail: theme }));
  } catch (_) {}
}
