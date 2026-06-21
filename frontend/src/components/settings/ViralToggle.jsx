import { motion } from "framer-motion";

/** Brand gradient switch — used for AI settings and other premium toggles. */
export default function ViralToggle({ checked, onChange, testId, offClassName = "bg-zinc-200 dark:bg-zinc-700" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 ${
        checked
          ? "gradient-linkedin shadow-[0_0_16px_rgba(124,58,237,0.35)]"
          : offClassName
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
