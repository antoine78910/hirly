import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  Loader2, User as UserIcon, FileText, Briefcase, FileStack,
  Bell, Settings as SettingsIcon, ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import PersonalInfoSheet from "../components/PersonalInfoSheet";
import ResumeSheet from "../components/ResumeSheet";
import ProfessionalProfileSheet from "../components/ProfessionalProfileSheet";
import DocumentsSheet from "../components/DocumentsSheet";
import Sheet, { SaveButton } from "../components/Sheet";
import PlacesAutocomplete, { hasGooglePlacesKey } from "../components/PlacesAutocomplete";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import RolePicker from "../components/RolePicker";

function CategoryCard({ icon: Icon, title, body, onClick, testId }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="w-full flex items-start gap-4 p-5 rounded-2xl border border-sprout-border bg-sprout-surface hover:bg-sprout-surface-2 transition-colors text-left"
    >
      <div className="w-14 h-14 rounded-full bg-sprout-mint-soft-2 grid place-items-center shrink-0">
        <Icon className="w-6 h-6 text-sprout-mint" strokeWidth={1.9} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-bold text-white text-xl leading-tight">{title}</h3>
        <p className="mt-2 text-[14px] leading-snug text-sprout-muted">{body}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-sprout-muted mt-2 shrink-0" />
    </button>
  );
}

function JobPreferencesSheet({ open, profile, onClose, onSaved }) {
  const [targetRole, setTargetRole] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [remote, setRemote] = useState("any");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetRole(profile?.target_role || profile?.target_roles?.[0] || "");
    setTargetLocation(profile?.target_location_data?.location_label || profile?.target_location || "");
    setTargetLocationData(profile?.target_location_data || null);
    setRemote(profile?.remote_preference || "any");
  }, [open, profile]);

  const save = async () => {
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
      toast.success("Preferences saved");
      await onSaved?.();
      onClose();
    } catch (_) {
      toast.error("Could not save preferences");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title="Job Preferences"
      onClose={onClose}
      testId="job-preferences-sheet"
      footer={<SaveButton saving={saving} onClick={save} testId="job-preferences-save" />}
    >
      <div className="space-y-4">
        <RolePicker value={targetRole} onChange={setTargetRole} testId="job-prefs-role" />
        <PlacesAutocomplete
          label="Target location"
          optional
          value={targetLocation}
          selectedLocation={targetLocationData}
          onInputChange={setTargetLocation}
          onSelect={(loc) => {
            setTargetLocationData(loc);
            if (loc) setTargetLocation(loc.location_label);
          }}
          placeholder="Search for a city or country"
          testId="job-prefs-location"
        />
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Remote preference</Label>
          <Select value={remote} onValueChange={setRemote}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="job-prefs-remote">
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
    </Sheet>
  );
}

export default function Profile() {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openSheet, setOpenSheet] = useState(null); // "personal" | "resume" | "professional" | "documents"

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/profile");
      setProfile(data);
      await checkAuth?.();
    } catch (_) {}
  }, [checkAuth]);

  useEffect(() => {
    (async () => { try { await reload(); } finally { setLoading(false); } })();
  }, [reload]);

  if (loading) {
    return (
      <div className="sprout min-h-dvh bg-sprout-bg flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-sprout-muted" />
      </div>
    );
  }

  const firstName = (profile?.contact?.name || user?.name || "").split(" ")[0] || "You";
  const email = profile?.contact?.email || user?.email;

  return (
    <div className="sprout min-h-dvh bg-sprout-bg text-white pb-28 max-w-md mx-auto px-5">
      <header className="pt-6 flex items-center justify-between" data-testid="profile-header">
        <div className="flex items-center gap-2">
          <UserIcon className="w-6 h-6 text-white" strokeWidth={2} />
          <h1 className="font-display font-bold text-3xl tracking-tight">Profile</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface"
            data-testid="profile-bell-btn"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={() => navigate("/settings")}
            className="w-10 h-10 grid place-items-center rounded-full hover:bg-sprout-surface"
            data-testid="profile-settings-btn"
            aria-label="Settings"
          >
            <SettingsIcon className="w-5 h-5 text-white" />
          </button>
        </div>
      </header>

      <section className="mt-2 flex items-center gap-4">
        {user?.picture ? (
          <img
            src={user.picture}
            alt={firstName}
            className="w-20 h-20 rounded-full border border-sprout-border object-cover"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-sprout-mint text-white grid place-items-center font-display font-black text-3xl">
            {(firstName[0] || "U").toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-black text-3xl tracking-tight leading-tight truncate">{firstName}</h2>
          <p className="text-sm text-sprout-muted truncate">{email}</p>
        </div>
      </section>

      <div className="mt-6 space-y-4" data-testid="profile-categories">
        <CategoryCard
          icon={SlidersHorizontal}
          title="Job preferences"
          body="Set the role, location, and remote preference used for your job feed."
          onClick={() => setOpenSheet("preferences")}
          testId="profile-preferences-card"
        />
        <CategoryCard
          icon={UserIcon}
          title="Personal details"
          body="Edit the personal info we use on every application you send."
          onClick={() => setOpenSheet("personal")}
          testId="profile-personal-card"
        />
        <CategoryCard
          icon={FileText}
          title="Your CV"
          body="View, refresh, or replace the CV we tailor to every job."
          onClick={() => setOpenSheet("resume")}
          testId="profile-resume-card"
        />
        <CategoryCard
          icon={Briefcase}
          title="Professional profile"
          body="Manage experience, education, skills, and everything else recruiters see."
          onClick={() => setOpenSheet("professional")}
          testId="profile-professional-card"
        />
        <CategoryCard
          icon={FileStack}
          title="Other files"
          body="Add transcripts, portfolios, certificates and other supporting docs."
          onClick={() => setOpenSheet("documents")}
          testId="profile-documents-card"
        />
      </div>

      <PersonalInfoSheet
        open={openSheet === "personal"}
        profile={profile}
        userEmail={user?.email}
        onClose={() => setOpenSheet(null)}
        onSaved={reload}
      />
      <JobPreferencesSheet
        open={openSheet === "preferences"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onSaved={reload}
      />
      <ResumeSheet
        open={openSheet === "resume"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onUploaded={reload}
      />
      <ProfessionalProfileSheet
        open={openSheet === "professional"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onChange={reload}
      />
      <DocumentsSheet
        open={openSheet === "documents"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
      />
    </div>
  );
}
