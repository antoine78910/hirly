import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import RolePicker from "./RolePicker";
import PlacesAutocomplete from "./PlacesAutocomplete";
import { useAppLocale } from "../context/AppLocaleContext";
import { normalizeLocationData } from "../lib/targetPreferences";

export default function TargetSearchSheet({
  open,
  initialRole = "",
  initialLocation = "",
  initialLocationData = null,
  onClose,
  onSave,
}) {
  const { lang } = useAppLocale();
  const [targetRole, setTargetRole] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetRole(initialRole);
    setTargetLocation(initialLocation);
    setTargetLocationData(initialLocationData);
  }, [open, initialRole, initialLocation, initialLocationData]);

  const save = async () => {
    const trimmedRole = (targetRole || "").trim();
    if (!trimmedRole) {
      toast.error(lang === "fr" ? "Saisissez un métier" : "Enter a job title");
      return;
    }
    setSaving(true);
    try {
      const trimmedLocation = (targetLocation || "").trim();
      const normalizedData = normalizeLocationData(trimmedLocation, targetLocationData);
      const locationLabel = normalizedData?.location_label || trimmedLocation || "Anywhere";
      const ok = await onSave?.({
        role: trimmedRole,
        location: locationLabel,
        locationData: normalizedData,
      });
      if (ok === false) return;
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[65] bg-black/30"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-[66] max-h-[88dvh] overflow-hidden rounded-t-3xl border-t border-zinc-200 bg-white text-zinc-900 shadow-2xl"
            data-testid="target-search-sheet"
          >
            <div className="mx-auto w-full max-w-md px-5 pb-safe pt-4">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                <h2 className="font-display text-lg font-bold tracking-tight">{lang === "fr" ? "Que recherchez-vous ?" : "What are you looking for?"}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
                  aria-label="Close"
                  data-testid="target-search-close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[calc(88dvh-9rem)] space-y-5 overflow-y-auto py-5">
                <RolePicker
                  value={targetRole}
                  onChange={setTargetRole}
                  variant="light"
                  lang={lang}
                  inline
                  testId="target-search-role"
                />
                <PlacesAutocomplete
                  label={lang === "fr" ? "Où cherchez-vous ?" : "Where are you searching?"}
                  optional
                  light
                  variant="light"
                  value={targetLocation}
                  selectedLocation={targetLocationData}
                  onInputChange={setTargetLocation}
                  onSelect={(loc) => {
                    setTargetLocationData(loc);
                    if (loc) setTargetLocation(loc.location_label);
                  }}
                  placeholder={lang === "fr" ? "Ville, région ou pays" : "City, region, or country"}
                  lang={lang}
                  testId="target-search-location"
                />
              </div>

              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="mb-4 flex h-12 w-full items-center justify-center rounded-full gradient-linkedin text-base font-semibold text-white hover:opacity-90 disabled:opacity-60"
                data-testid="target-search-save"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : (lang === "fr" ? "Mettre à jour la recherche" : "Update search")}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
