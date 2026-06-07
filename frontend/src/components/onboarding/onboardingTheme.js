import { sel } from "../../lib/selectionTheme";

/** Light LP-aligned tokens for onboarding (white background). */
export const ob = {
  step: "flex flex-1 flex-col min-h-0 overflow-hidden",
  stepBody: "mt-2 sm:mt-3 flex-1 min-h-0 flex flex-col justify-center overflow-hidden",
  title: "font-display font-black text-[1.35rem] sm:text-2xl lg:text-[1.75rem] tracking-tight leading-tight text-zinc-900",
  introTitle:
    "font-display font-black text-[1.65rem] sm:text-3xl lg:text-[2.25rem] tracking-tight leading-[1.12] text-zinc-900 text-center max-w-md",
  introBody:
    "text-zinc-600 text-base sm:text-lg leading-relaxed text-center max-w-md px-1",
  introDots: "flex shrink-0 items-center justify-center gap-2 pt-3 sm:pt-4",
  subtitle: "mt-1 sm:mt-1.5 text-zinc-600 text-sm sm:text-[15px] leading-snug",
  optionList: "space-y-1.5 sm:space-y-2",
  optionGrid: "grid grid-cols-2 gap-1.5 sm:gap-2",
  chip:
    "inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-full text-xs sm:text-sm font-medium border transition-colors duration-200 ease-out active:scale-[0.97]",
  chipGrid: "grid grid-cols-2 gap-2 sm:gap-2.5 content-start overflow-y-auto pr-0.5",
  chipGridItem:
    "flex w-full min-h-[2.75rem] items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-[11px] font-medium leading-tight transition-all duration-200 ease-out active:scale-[0.98] sm:min-h-[3rem] sm:px-3 sm:py-2.5 sm:text-xs",
  card: "rounded-2xl border border-zinc-200 bg-white shadow-sm",
  cardInner: "rounded-2xl border border-zinc-200 bg-zinc-50/80",
  chipOn: sel.chipOn,
  chipOff: sel.chipOff,
  optionOn: sel.optionOn,
  optionOff: sel.optionOff,
  accent: "text-linkedin",
  accentSoft: "bg-linkedin-light",
  muted: "text-zinc-600",
  dim: "text-zinc-500",
  slider:
    "[&_[role=slider]]:bg-linkedin [&_[role=slider]]:border-linkedin [&_.bg-primary]:bg-linkedin [&_.bg-primary\\/20]:bg-linkedin/20",
};
