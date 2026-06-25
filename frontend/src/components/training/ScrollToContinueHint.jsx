import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ScrollToContinueHint({ visible, lang }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex justify-center py-3"
          data-testid="scroll-to-continue-hint"
        >
          <div className="inline-flex max-w-md items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-2.5 text-center text-sm font-medium text-violet-800 shadow-sm">
            <ChevronDown className="h-4 w-4 shrink-0 animate-bounce text-violet-500" aria-hidden />
            <span>
              {lang === "fr"
                ? "Fais défiler pour continuer — lis le contenu et réponds au questionnaire"
                : "Scroll to continue — read the content and complete the quiz"}
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
