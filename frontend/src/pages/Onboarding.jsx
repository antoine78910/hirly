import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Upload, FileText, Loader2, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import PlacesAutocomplete, { hasGooglePlacesKey } from "../components/PlacesAutocomplete";
import RolePicker from "../components/RolePicker";

const PARSING_STEPS = [
  "Reading your CV…",
  "Extracting your skills…",
  "Mapping your experience…",
  "Finding the perfect roles for you…",
  "Polishing your profile…",
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { setHasProfile, setHasPreferences } = useAuth();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsePhase, setParsePhase] = useState(0);
  const [profile, setProfile] = useState(null);
  const [targetRole, setTargetRole] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [remote, setRemote] = useState("any");
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  useEffect(() => {
    if (!parsing) return;
    setParsePhase(0);
    const t = setInterval(() => setParsePhase((p) => Math.min(p + 1, PARSING_STEPS.length - 1)), 1200);
    return () => clearInterval(t);
  }, [parsing]);

  const handleUpload = async (f) => {
    if (!f) return;
    setFile(f);
    setParsing(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const { data } = await api.post("/profile/cv", form, { headers: { "Content-Type": "multipart/form-data" } });
      setProfile(data);
      setHasProfile(true);
      setTargetRole((data.target_roles && data.target_roles[0]) || "");
      setTargetLocation(data.contact?.location || "");
      setTargetLocationData(null);
      toast.success("Your profile is ready");
      setStep(2);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to parse CV");
    } finally { setParsing(false); }
  };

  const handlePrefs = async () => {
    if (hasGooglePlacesKey() && targetLocation && !targetLocationData) {
      toast.error("Select a location from the suggestions");
      return;
    }
    setSaving(true);
    try {
      await api.put("/profile/preferences", {
        target_role: targetRole,
        target_location: targetLocationData?.location_label || targetLocation,
        target_location_data: targetLocationData,
        remote_preference: remote,
      });
      setHasPreferences(true);
      navigate("/swipe", { replace: true });
    } catch (e) { toast.error("Failed to save preferences"); }
    finally { setSaving(false); }
  };

  const skipPrefs = async () => {
    setSaving(true);
    try {
      await api.put("/profile/preferences", {
        target_role: targetRole || (profile?.target_roles?.[0] || "Engineer"),
        target_location: "",
        target_location_data: null,
        remote_preference: "any",
      });
      setHasPreferences(true);
      navigate("/swipe", { replace: true });
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white">
      <div className="max-w-md mx-auto px-6 pt-10 pb-24">
        <div className="flex items-center gap-2 mb-8">
          <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-sprout-mint" : "bg-sprout-border"}`} />
          <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? "bg-sprout-mint" : "bg-sprout-border"}`} />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && !parsing && (
            <motion.div key="s1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <h1 className="font-display font-black text-4xl tracking-tighter leading-tight text-white">Upload your CV.</h1>
              <p className="mt-3 text-sprout-muted text-[15px] leading-relaxed">
                One upload. Infinite tailored applications. Takes ~10 seconds.
              </p>

              <label
                htmlFor="cv-input"
                data-testid="cv-dropzone"
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleUpload(f);
                }}
                className={`mt-8 block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? "border-sprout-mint bg-sprout-mint-soft scale-[1.01]" : "border-sprout-border hover:border-sprout-border-2"
                }`}
              >
                {!file ? (
                  <>
                    <Upload className="w-9 h-9 mx-auto text-sprout-mint mb-3" strokeWidth={1.75} />
                    <p className="font-semibold text-white">Drop your CV here</p>
                    <p className="text-sm text-sprout-muted mt-1">PDF or DOCX · we keep your template</p>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-zinc-200">
                    <FileText className="w-5 h-5" />
                    <span className="font-medium text-sm">{file.name}</span>
                  </div>
                )}
                <input
                  ref={inputRef} id="cv-input" data-testid="cv-file-input" type="file"
                  accept=".pdf,.docx,.txt" className="hidden"
                  onChange={(e) => handleUpload(e.target.files?.[0])}
                />
              </label>

              <ul className="mt-6 space-y-1.5 text-sm text-sprout-muted">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-sprout-mint" /> ATS-friendly extraction</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-sprout-mint" /> Original CV preserved</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-sprout-mint" /> Never shared without your swipe</li>
              </ul>
            </motion.div>
          )}

          {parsing && (
            <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2">
              <h1 className="font-display font-black text-4xl tracking-tighter leading-tight">
                Reading your CV<span className="text-sprout-mint">…</span>
              </h1>
              <p className="mt-3 text-sprout-muted">Claude Sonnet 4.5 is building your profile.</p>
              <div className="mt-10 space-y-3">
                {PARSING_STEPS.map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: i <= parsePhase ? 1 : 0.3 }}
                    className="flex items-center gap-3"
                    data-testid={`parse-step-${i}`}
                  >
                    {i < parsePhase ? (
                      <CheckCircle2 className="w-5 h-5 text-sprout-mint shrink-0" />
                    ) : i === parsePhase ? (
                      <Loader2 className="w-5 h-5 text-sprout-mint animate-spin shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-sprout-border shrink-0" />
                    )}
                    <span className={`text-[15px] ${i <= parsePhase ? "text-white font-medium" : "text-sprout-dim"}`}>{s}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {step === 2 && !parsing && (
            <motion.div key="s2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sprout-mint-soft text-sprout-mint text-xs font-semibold mb-5">
                <CheckCircle2 className="w-3.5 h-3.5" /> CV imported{profile?.contact?.name ? ` · ${profile.contact.name}` : ""}
              </div>
              <h1 className="font-display font-black text-4xl tracking-tighter leading-tight">What roles are you after?</h1>
              <p className="mt-3 text-sprout-muted">Pick a quick suggestion or type your own. You can change everything later.</p>

              {profile?.target_roles?.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2" data-testid="role-suggestions-top">
                  {profile.target_roles.slice(0, 6).map((r) => (
                    <motion.button
                      key={r}
                      type="button"
                      onClick={() => setTargetRole(r)}
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      className={`text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${
                        targetRole === r
                          ? "bg-sprout-mint text-white border-sprout-mint"
                          : "bg-sprout-surface-2 text-zinc-200 border-sprout-border hover:border-sprout-mint hover:text-sprout-mint"
                      }`}
                      data-testid={`suggest-role-top-${r}`}
                    >
                      {r}
                    </motion.button>
                  ))}
                </div>
              )}

              <div className="mt-7 space-y-4">
                <RolePicker value={targetRole} onChange={setTargetRole} testId="target-role-picker" />
                <PlacesAutocomplete
                  label="Location"
                  optional
                  value={targetLocation}
                  selectedLocation={targetLocationData}
                  onInputChange={setTargetLocation}
                  onSelect={(loc) => {
                    setTargetLocationData(loc);
                    if (loc) setTargetLocation(loc.location_label);
                  }}
                  placeholder="e.g. New York or United Kingdom"
                  testId="target-location"
                />
                <div>
                  <Label className="text-sm font-semibold text-zinc-200">Remote preference</Label>
                  <Select value={remote} onValueChange={setRemote}>
                    <SelectTrigger className="mt-1.5 h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="remote-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-sprout-surface border-sprout-border text-white">
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="remote">Remote only</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                      <SelectItem value="onsite">On-site</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                data-testid="start-swiping-btn"
                onClick={handlePrefs}
                disabled={!targetRole || saving}
                className="mt-8 w-full h-12 rounded-full bg-sprout-mint hover:opacity-90 text-white font-semibold"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Sparkles className="w-4 h-4 mr-1.5" /> Start swiping <ArrowRight className="w-4 h-4 ml-1.5" /></>)}
              </Button>
              <button
                onClick={skipPrefs}
                className="mt-3 w-full text-sm text-sprout-muted hover:text-white"
                data-testid="skip-prefs-btn"
              >
                Skip — just show me jobs
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
