import { AnimatePresence, motion } from "framer-motion";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";

export default function LandingPhoneNotifications({ items, anchor = "phone" }) {
  const positionClass = anchor === "cards" ? "bottom-[7.5rem] right-2.5" : "bottom-3 right-2.5";

  return (
    <div className={`absolute z-30 flex max-w-[88%] flex-col items-end gap-2 ${positionClass}`}>
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.94, x: 12 }}
            animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, x: 8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="w-[min(100%,220px)] rounded-2xl border border-zinc-200/80 bg-white/95 px-3 py-2.5 shadow-[0_8px_28px_-6px_rgba(0,0,0,0.22)] backdrop-blur-md"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-zinc-100">
                <Logo size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {BRAND.NAME}
                </p>
                <p className="mt-0.5 text-xs font-semibold leading-snug text-zinc-900">
                  {item.title}
                </p>
                {item.body ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{item.body}</p>
                ) : null}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
