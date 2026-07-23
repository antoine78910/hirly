import { useState, useEffect } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import Sheet, { Field, SaveButton } from "./Sheet";

/**
 * Personal Information slide-in sheet.
 * Auto-binds email from the authenticated user (read-only — user explicitly
 * asked us to always use the registered email automatically).
 */
export default function PersonalInfoSheet({ open, profile, userEmail, onClose, onSaved }) {
  const [c, setC] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open)
      setC({ ...(profile?.contact || {}), email: userEmail || profile?.contact?.email || "" });
  }, [open, profile, userEmail]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/profile/contact", { ...c, email: userEmail || c.email });
      toast.success("Saved");
      onSaved?.();
      onClose();
    } catch (_e) {
      toast.error("Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title="Personal Information"
      onClose={onClose}
      testId="personal-info-sheet"
      footer={<SaveButton saving={saving} onClick={save} testId="personal-info-save" />}
    >
      <div className="space-y-4">
        <Field
          label="Full name"
          value={c.name}
          onChange={(v) => setC({ ...c, name: v })}
          placeholder="Jane Doe"
          testId="pi-name"
        />
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-zinc-200">
            Email <span className="text-sprout-dim text-xs">(from your Google account)</span>
          </p>
          <div
            className="h-11 rounded-xl bg-sprout-surface border border-sprout-border px-4 flex items-center text-zinc-300"
            data-testid="pi-email-readonly"
          >
            {userEmail || c.email || "—"}
          </div>
        </div>
        <Field
          label="Phone"
          value={c.phone}
          onChange={(v) => setC({ ...c, phone: v })}
          placeholder="+1 555 0100"
          testId="pi-phone"
        />
        <Field
          label="Location"
          value={c.location}
          onChange={(v) => setC({ ...c, location: v })}
          placeholder="City, Country"
          testId="pi-location"
        />
        <Field
          label="LinkedIn"
          value={c.linkedin}
          onChange={(v) => setC({ ...c, linkedin: v })}
          placeholder="linkedin.com/in/…"
          testId="pi-linkedin"
        />
        <Field
          label="Website"
          value={c.website}
          onChange={(v) => setC({ ...c, website: v })}
          placeholder="yoursite.com"
          testId="pi-website"
        />
      </div>
    </Sheet>
  );
}
