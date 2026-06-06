import { ob } from "./onboardingTheme";

export default function SelectionCard({ selected, onClick, icon: Icon, title, hint, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border text-left transition-all duration-200 ease-out active:scale-[0.99] ${
        selected ? ob.optionOn : ob.optionOff
      }`}
    >
      {Icon ? <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${ob.accent} shrink-0`} strokeWidth={2} /> : null}
      <div className="min-w-0">
        <p className="font-semibold text-sm sm:text-[15px] text-zinc-900 leading-tight">{title}</p>
        {hint ? <p className={`text-xs ${ob.muted} mt-0.5 leading-snug line-clamp-1`}>{hint}</p> : null}
      </div>
    </button>
  );
}
