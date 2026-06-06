import { ob } from "./onboardingTheme";

export default function SelectionCard({ selected, onClick, icon: Icon, title, hint, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full flex items-start gap-4 px-4 sm:px-5 py-4 sm:py-5 rounded-2xl border text-left transition-all ${
        selected ? ob.optionOn : ob.optionOff
      }`}
    >
      {Icon ? <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${ob.accent} mt-0.5 shrink-0`} strokeWidth={2} /> : null}
      <div className="min-w-0">
        <p className="font-semibold text-[15px] sm:text-base text-zinc-900">{title}</p>
        {hint ? <p className={`text-sm ${ob.muted} mt-0.5 leading-relaxed`}>{hint}</p> : null}
      </div>
    </button>
  );
}
