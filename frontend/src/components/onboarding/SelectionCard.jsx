import { Check } from "lucide-react";
import { sel } from "../../lib/selectionTheme";
import { ob } from "./onboardingTheme";

export default function SelectionCard({
  selected,
  onClick,
  icon: Icon,
  title,
  hint,
  testId,
  showCheck = false,
  variant = "default",
}) {
  if (variant === "qcm-timeline") {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={`relative w-full overflow-hidden flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-2xl border px-4 py-3.5 text-center transition-all duration-200 ease-out active:scale-[0.99] sm:min-h-[3.5rem] sm:py-4 ${
          selected ? ob.optionOn : ob.optionOff
        }`}
      >
        {showCheck && selected ? (
          <span
            className={`${sel.checkDot} absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center`}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        ) : null}
        <div className={`flex w-full flex-col items-center gap-1 ${showCheck ? "px-6" : "px-2"}`}>
          <div className="flex max-w-full items-center justify-center gap-2">
            {Icon ? <Icon className={`h-4 w-4 shrink-0 ${ob.accent}`} strokeWidth={2} /> : null}
            <p className="text-sm font-semibold leading-snug text-zinc-900">{title}</p>
          </div>
          {hint ? (
            <p className={`max-w-[18rem] text-center text-xs leading-snug ${ob.muted}`}>{hint}</p>
          ) : null}
        </div>
      </button>
    );
  }

  if (variant === "qcm") {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={`relative flex w-full min-h-[3.5rem] items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 ease-out active:scale-[0.99] sm:min-h-0 sm:py-3 ${
          selected ? ob.optionOn : ob.optionOff
        } ${showCheck ? "pr-11" : ""}`}
      >
        {Icon ? (
          <Icon className={`h-4 w-4 shrink-0 sm:h-5 sm:w-5 ${ob.accent}`} strokeWidth={2} />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-zinc-900">{title}</p>
          {hint ? <p className={`mt-0.5 text-xs leading-snug ${ob.muted}`}>{hint}</p> : null}
        </div>
        {showCheck && selected ? (
          <span
            className={`${sel.checkDot} absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center`}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex w-full min-h-[3.5rem] items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200 ease-out active:scale-[0.99] sm:min-h-0 sm:px-4 sm:py-3 ${
        selected ? ob.optionOn : ob.optionOff
      }`}
    >
      {Icon ? (
        <Icon className={`h-4 w-4 shrink-0 sm:h-5 sm:w-5 ${ob.accent}`} strokeWidth={2} />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-zinc-900 sm:text-[15px]">{title}</p>
        {hint ? <p className={`mt-0.5 text-xs leading-snug ${ob.muted}`}>{hint}</p> : null}
      </div>
      {showCheck && selected ? (
        <span className={`${sel.checkDot} flex h-5 w-5 shrink-0 items-center justify-center`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}
