import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import RolePicker from "./RolePicker";
import PlacesAutocomplete from "./PlacesAutocomplete";
import { useAppLocale } from "../context/AppLocaleContext";
import { normalizeLocationData } from "../lib/targetPreferences";
import { isResolvedLocation } from "../lib/locationSearch";
import { MATCHING_INDUSTRIES, MATCHING_SECTORS } from "../lib/matchingFacets";

function FacetPicker({ label, options, values, onChange }) {
  const toggle = (value) => onChange((current) => current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-zinc-800">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => toggle(value)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${values.includes(value)
              ? "border-violet-500 bg-violet-50 text-violet-700"
              : "border-zinc-200 text-zinc-600 hover:border-zinc-300"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TargetSearchSheet({
  open,
  initialRole = "",
  initialRoles = [],
  initialSectorIds = [],
  initialIndustryIds = [],
  initialLocation = "",
  initialLocationData = null,
  onClose,
  onSave,
}) {
  const { lang } = useAppLocale();
  const [roleDraft, setRoleDraft] = useState("");
  const [targetRoles, setTargetRoles] = useState([]);
  const [sectorIds, setSectorIds] = useState([]);
  const [industryIds, setIndustryIds] = useState([]);
  const [targetLocation, setTargetLocation] = useState("");
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const roles = Array.isArray(initialRoles) && initialRoles.length
      ? initialRoles
      : [initialRole];
    setTargetRoles([...new Set(roles.map((role) => String(role || "").trim()).filter(Boolean))].slice(0, 3));
    setRoleDraft("");
    setSectorIds(Array.isArray(initialSectorIds) ? initialSectorIds : []);
    setIndustryIds(Array.isArray(initialIndustryIds) ? initialIndustryIds : []);
    setTargetLocation(initialLocation);
    setTargetLocationData(initialLocationData);
  }, [open, initialRole, initialRoles, initialSectorIds, initialIndustryIds, initialLocation, initialLocationData]);

  const save = async () => {
    const roles = [...new Set([...targetRoles, ...(roleDraft.trim() ? [roleDraft.trim()] : [])])].slice(0, 3);
    if (!roles.length) {
      toast.error(lang === "fr" ? "Saisissez un métier" : "Enter a job title");
      return;
    }
    setSaving(true);
    try {
      const trimmedLocation = (targetLocation || "").trim();
      const normalizedData = normalizeLocationData(trimmedLocation, targetLocationData);
      if (trimmedLocation && !isResolvedLocation(normalizedData, trimmedLocation)) {
        toast.error(lang === "fr" ? "Choisissez une ville dans les suggestions" : "Select a location from the suggestions");
        return;
      }
      const locationLabel = normalizedData?.location_label || trimmedLocation || "Anywhere";
      const ok = await onSave?.({
        role: roles[0],
        roles,
        sectorIds,
        industryIds,
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
                  value={roleDraft}
                  onChange={setRoleDraft}
                  variant="light"
                  lang={lang}
                  inline
                  testId="target-search-role"
                />
                <div className="flex flex-wrap gap-2">
                  {targetRoles.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setTargetRoles((roles) => roles.filter((entry) => entry !== role))}
                      className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-sm text-violet-800"
                    >
                      {role}<X className="h-3.5 w-3.5" />
                    </button>
                  ))}
                  {roleDraft.trim() && targetRoles.length < 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTargetRoles((roles) => [...new Set([...roles, roleDraft.trim()])].slice(0, 3));
                        setRoleDraft("");
                      }}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-700 hover:border-zinc-300"
                    >
                      + {lang === "fr" ? "Ajouter ce métier" : "Add this role"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  {lang === "fr" ? "Ajoutez jusqu’à 3 métiers. Les offres correspondant à l’un d’eux seront classées ensemble." : "Add up to 3 roles. Jobs matching any role are ranked together."}
                </p>
                <FacetPicker
                  label={lang === "fr" ? "Secteurs" : "Sectors"}
                  options={MATCHING_SECTORS}
                  values={sectorIds}
                  onChange={setSectorIds}
                />
                <FacetPicker
                  label={lang === "fr" ? "Industries" : "Industries"}
                  options={MATCHING_INDUSTRIES}
                  values={industryIds}
                  onChange={setIndustryIds}
                />
                <PlacesAutocomplete
                  label={lang === "fr" ? "Où cherchez-vous ?" : "Where are you searching?"}
                  optional
                  requireSelection
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
