import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import RolePicker from "./RolePicker";
import PlacesAutocomplete, { hasGooglePlacesKey } from "./PlacesAutocomplete";

export default function TargetSearchSheet({
  open,
  initialRole = "",
  initialLocation = "",
  initialLocationData = null,
  onClose,
  onSaved,
}) {
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
    const role = targetRole.trim();
    if (!role) {
      toast.error("Please choose a target role");
      return;
    }
    if (hasGooglePlacesKey() && targetLocation.trim() && !targetLocationData) {
      toast.error("Select a location from the suggestions");
      return;
    }
    const locationLabel = targetLocationData?.location_label || targetLocation.trim();
    setSaving(true);
    try {
      await api.put("/profile/preferences", {
        target_role: role,
        target_roles: [role],
        target_location: locationLabel,
        target_location_data: targetLocationData,
      });
      toast.success("Search updated");
      await onSaved?.({
        role,
        location: locationLabel || "Anywhere",
        locationData: targetLocationData,
      });
      onClose();
    } catch (_) {
      toast.error("Could not save search preferences");
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
                <h2 className="font-display text-lg font-bold tracking-tight">What are you looking for?</h2>
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
                  testId="target-search-role"
                />
                <PlacesAutocomplete
                  label="Where are you searching?"
                  optional
                  light
                  value={targetLocation}
                  selectedLocation={targetLocationData}
                  onInputChange={setTargetLocation}
                  onSelect={(loc) => {
                    setTargetLocationData(loc);
                    if (loc) setTargetLocation(loc.location_label);
                  }}
                  placeholder="City, region, or country"
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
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update search"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
