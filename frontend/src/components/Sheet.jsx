import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * Generic mobile slide-in sheet (right→left). Use for Profile sub-pages.
 * Renders nothing when `open` is false.
 */
export default function Sheet({ open, title, onClose, children, footer, testId }) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="sprout fixed inset-0 z-[70] bg-sprout-bg text-white flex flex-col"
          data-testid={testId}
        >
          <header className="px-5 pt-6 pb-3 flex items-center gap-3 border-b border-sprout-border">
            <button
              onClick={onClose}
              className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface"
              data-testid={`${testId}-close`}
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white" />
            </button>
            <h2 className="font-display font-bold text-xl flex-1">{title}</h2>
          </header>
          <div className="flex-1 overflow-y-auto px-5 pb-32 pt-5">{children}</div>
          {footer && (
            <div
              className="fixed bottom-0 inset-x-0 z-[71] bg-sprout-bg/95 backdrop-blur-xl border-t border-sprout-border"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)", paddingTop: 12 }}
            >
              <div className="max-w-md mx-auto px-5">{footer}</div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Convenience input + label pair styled for sheets. */
export function Field({ label, value, onChange, placeholder, testId, type = "text" }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-zinc-200">{label}</Label>
      <Input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testId}
        className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim"
      />
    </div>
  );
}

export function SaveButton({ saving, onClick, label = "Save", testId = "sheet-save-btn" }) {
  return (
    <Button
      onClick={onClick}
      disabled={saving}
      className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white shadow-[0_8px_24px_rgba(124,58,237,0.28)] hover:opacity-90"
      data-testid={testId}
    >
      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : label}
    </Button>
  );
}
