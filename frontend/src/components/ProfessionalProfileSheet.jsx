import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, ChevronRight, Plus, Palette, Briefcase, Heart, Folder,
  GraduationCap, Code2, Award, Trophy, Newspaper, Star, Languages as LangIcon,
  Users2, Lightbulb, Settings as Cog, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import Sheet from "./Sheet";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/* ============================================================
   Professional Profile (replaces the old read-only ProfessionalSheet).
   - Listing screen — three grouped sections, each row with icon, label, count badge or "Add".
   - Per-section editor — for "extra" sections (volunteer, projects, certifications, awards,
     publications, recognition, languages, interests, references, key highlights, custom fields)
     we persist arrays inside `profile.extras[<section_key>]` via `PATCH /api/profile/extras`.
   - For sections already populated by AI (experience, education, skills) we show the parsed
     items read-only with the same list UI.
============================================================ */

const FIELD_SCHEMAS = {
  // Each section has a `singular` label + a `fields[]` schema for the Edit Entry form.
  overview: {
    singular: "Professional Overview",
    fields: [
      { key: "role",    label: "Role",    placeholder: "Student, Designer, Engineer…" },
      { key: "summary", label: "Summary", placeholder: "1-2 sentences about you", textarea: true },
    ],
  },
  experience: {
    singular: "Experience",
    aiBacked: true,
    fields: [
      { key: "role",     label: "Role" },
      { key: "company",  label: "Company" },
      { key: "duration", label: "Duration", placeholder: "Jan 2023 — Present" },
      { key: "location", label: "Location" },
      { key: "highlights", label: "Highlights", textarea: true, placeholder: "One bullet per line" },
    ],
  },
  volunteer: {
    singular: "Volunteer Experience",
    fields: [
      { key: "role", label: "Role" },
      { key: "organization", label: "Organization" },
      { key: "duration", label: "Duration" },
      { key: "details", label: "Details", textarea: true },
    ],
  },
  projects: {
    singular: "Project",
    fields: [
      { key: "name", label: "Project name" },
      { key: "url", label: "URL", placeholder: "https://…" },
      { key: "stack", label: "Stack", placeholder: "Comma-separated" },
      { key: "description", label: "Description", textarea: true },
    ],
  },
  education: {
    singular: "Education",
    aiBacked: true,
    fields: [
      { key: "degree", label: "Degree" },
      { key: "school", label: "School" },
      { key: "year",   label: "Year" },
    ],
  },
  skills: {
    singular: "Skill",
    aiBacked: true,
    simple: true, // list of strings
    fields: [{ key: "name", label: "Skill", placeholder: "e.g. React" }],
  },
  certifications: {
    singular: "Certification",
    fields: [
      { key: "name", label: "Certification" },
      { key: "issuer", label: "Issuer" },
      { key: "year", label: "Year" },
      { key: "credential_url", label: "Credential URL", placeholder: "https://…" },
    ],
  },
  awards: {
    singular: "Award",
    fields: [
      { key: "title", label: "Award" },
      { key: "issuer", label: "Issuer" },
      { key: "year", label: "Year" },
      { key: "details", label: "Details", textarea: true },
    ],
  },
  publications: {
    singular: "Publication",
    fields: [
      { key: "title", label: "Title" },
      { key: "venue", label: "Venue / Journal" },
      { key: "year", label: "Year" },
      { key: "url", label: "URL", placeholder: "https://…" },
    ],
  },
  recognition: {
    singular: "Recognition",
    fields: [
      { key: "title", label: "Recognition" },
      { key: "issuer", label: "Issuer" },
      { key: "year", label: "Year" },
    ],
  },
  languages: {
    singular: "Language",
    fields: [
      { key: "name", label: "Language" },
      { key: "proficiency", label: "Proficiency", placeholder: "Native / Fluent / Conversational" },
    ],
  },
  interests: {
    singular: "Interest",
    simple: true,
    fields: [{ key: "name", label: "Interest" }],
  },
  references: {
    singular: "References",
    fields: [
      { key: "name",    label: "Title & Company" },
      { key: "title",   label: "Title" },
      { key: "email",   label: "Email" },
      { key: "phone",   label: "Phone" },
    ],
  },
  key_highlights: {
    singular: "Key Highlight",
    simple: true,
    fields: [{ key: "text", label: "Highlight" }],
  },
  custom: {
    singular: "Custom Field",
    fields: [
      { key: "label", label: "Label" },
      { key: "value", label: "Value", textarea: true },
    ],
  },
};

const SECTIONS = [
  {
    group: "WORK & PROJECTS",
    rows: [
      { key: "experience", icon: Briefcase, label: "Experience" },
      { key: "volunteer",  icon: Heart,     label: "Volunteering" },
      { key: "projects",   icon: Folder,    label: "Projects" },
    ],
  },
  {
    group: "STUDIES & EXPERTISE",
    rows: [
      { key: "education",      icon: GraduationCap, label: "Education" },
      { key: "skills",         icon: Code2,         label: "Skills" },
      { key: "certifications", icon: Award,         label: "Certifications" },
    ],
  },
  {
    group: "EXTRAS & PERSONAL",
    rows: [
      { key: "awards",         icon: Trophy,    label: "Awards" },
      { key: "publications",   icon: Newspaper, label: "Publications" },
      { key: "recognition",    icon: Star,      label: "Recognition" },
      { key: "languages",      icon: LangIcon,  label: "Languages" },
      { key: "interests",      icon: Heart,     label: "Hobbies" },
      { key: "references",     icon: Users2,    label: "References" },
      { key: "key_highlights", icon: Lightbulb, label: "Highlights" },
      { key: "custom",         icon: Cog,       label: "Custom sections" },
    ],
  },
];

/* ----------------------- Editor (Add / Edit a single entry) ----------------------- */

function EntryEditor({ open, sectionKey, entry, onClose, onSave }) {
  const schema = FIELD_SCHEMAS[sectionKey];
  const [tab, setTab] = useState("basic");
  const [draft, setDraft] = useState({});

  useEffect(() => {
    if (open) {
      setDraft(entry || {});
      setTab("basic");
    }
  }, [open, entry]);

  if (!schema) return null;

  // If "simple" (list of strings), the only field is the first one — render a single input.
  const fields = schema.fields;
  const isNew = !entry;

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const handleSave = () => {
    if (schema.simple) {
      const value = draft[fields[0].key];
      if (!value || !String(value).trim()) return toast.error("Please fill the field");
      onSave(String(value).trim());
    } else {
      // require at least the first field
      const first = fields[0].key;
      if (!draft[first] || !String(draft[first]).trim()) return toast.error(`Please fill ${fields[0].label}`);
      onSave({ ...draft, _id: entry?._id });
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Edit Entry"
      onClose={onClose}
      testId="entry-editor-sheet"
    >
      <div className="-mt-2">
        <h2 className="font-display font-black text-3xl tracking-tight">{isNew ? `Add ${schema.singular}` : `Edit ${schema.singular}`}</h2>
        <p className="text-sprout-muted text-sm mt-1">{schema.singular === "References" ? "Professional references" : "Fill the details below"}</p>

        {!schema.simple && (
          <div className="mt-5 p-1 rounded-full bg-sprout-surface border border-sprout-border flex" data-testid="entry-tabs">
            {["basic", "details"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 h-10 rounded-full text-sm font-semibold capitalize transition-colors ${
                  tab === t ? "selection-tab-on text-violet-800" : "text-zinc-500"
                }`}
                data-testid={`entry-tab-${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 space-y-4">
          {fields.map((f, i) => {
            // Show first half on "basic", second half on "details" (for non-simple)
            if (!schema.simple) {
              const half = Math.ceil(fields.length / 2);
              const onBasic = i < half;
              if (tab === "basic" && !onBasic) return null;
              if (tab === "details" && onBasic) return null;
            }
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-sm font-semibold text-zinc-200">{f.label}</Label>
                {f.textarea ? (
                  <Textarea
                    rows={4}
                    value={draft[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="rounded-2xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim"
                    data-testid={`entry-field-${f.key}`}
                  />
                ) : (
                  <Input
                    value={draft[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim"
                    data-testid={`entry-field-${f.key}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={handleSave}
          className="mt-8 w-full h-12 rounded-full bg-sprout-mint text-white font-semibold hover:opacity-90"
          data-testid="entry-save-btn"
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

/* ----------------------- Section detail (list of entries) ----------------------- */

function SectionDetail({ open, sectionKey, items, label, onClose, onChange }) {
  const schema = FIELD_SCHEMAS[sectionKey];
  const [editing, setEditing] = useState(null); // null = none, "new" = new, item = edit
  const isAiBacked = schema?.aiBacked;

  const handleSave = (entry) => {
    if (schema.simple) {
      // string item
      if (editing === "new") onChange([...(items || []), entry]);
      else onChange((items || []).map((x) => (x === editing ? entry : x)));
    } else {
      if (editing === "new") onChange([...(items || []), { ...entry, _id: crypto.randomUUID() }]);
      else onChange((items || []).map((x) => (x._id === editing?._id ? { ...entry, _id: editing._id } : x)));
    }
    setEditing(null);
  };

  const handleDelete = (item) => {
    if (schema.simple) onChange((items || []).filter((x) => x !== item));
    else onChange((items || []).filter((x) => x._id !== item._id));
  };

  const renderItem = (item, i) => {
    if (schema.simple) {
      return (
        <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-sprout-border bg-sprout-surface" data-testid={`section-item-${i}`}>
          <span className="text-white font-medium">{item}</span>
          <button onClick={() => handleDelete(item)} className="text-rose-400 text-sm" data-testid={`section-delete-${i}`}>Remove</button>
        </div>
      );
    }
    const title = item.role || item.name || item.title || item.label || item.degree || Object.values(item)[0];
    const sub = item.company || item.school || item.organization || item.issuer || item.venue || item.proficiency || item.year || item.duration;
    return (
      <button
        key={item._id || i}
        onClick={() => !isAiBacked && setEditing(item)}
        className="w-full text-left p-4 rounded-2xl border border-sprout-border bg-sprout-surface hover:bg-sprout-surface-2 transition-colors"
        data-testid={`section-item-${i}`}
      >
        <p className="font-semibold text-white">{String(title || "")}</p>
        {sub && <p className="text-sm text-sprout-muted mt-0.5">{String(sub)}</p>}
        {item.details && <p className="text-sm text-sprout-muted mt-1 line-clamp-2">{item.details}</p>}
        {item.description && <p className="text-sm text-sprout-muted mt-1 line-clamp-2">{item.description}</p>}
        {Array.isArray(item.highlights) && (
          <ul className="mt-1 text-sm text-zinc-300 space-y-0.5">
            {item.highlights.slice(0, 2).map((h, j) => <li key={j}>— {h}</li>)}
          </ul>
        )}
      </button>
    );
  };

  return (
    <>
      <Sheet
        open={open && !editing}
        title={label}
        onClose={onClose}
        testId={`section-detail-${sectionKey}`}
      >
        <div className="-mt-2 flex items-center justify-between mb-5">
          <h2 className="font-display font-black text-2xl tracking-tight">{label}</h2>
          {!isAiBacked && (
            <button
              onClick={() => setEditing("new")}
              className="w-9 h-9 rounded-full grid place-items-center text-sprout-mint hover:bg-sprout-mint-soft"
              data-testid={`section-add-${sectionKey}`}
              aria-label="Add"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>

        {(items?.length ?? 0) === 0 ? (
          <div className="py-16 text-center" data-testid={`section-empty-${sectionKey}`}>
            <div className="mx-auto w-14 h-14 rounded-2xl bg-sprout-mint-soft-2 grid place-items-center mb-3">
              <Plus className="w-6 h-6 text-sprout-mint" />
            </div>
            <h3 className="font-display font-bold text-lg">No {label.toLowerCase()} yet</h3>
            <p className="mt-1 text-sprout-muted text-sm max-w-xs mx-auto">
              {isAiBacked ? "Upload your CV to populate this automatically." : `Tap “Add ${schema.singular}” to get started.`}
            </p>
            {!isAiBacked && (
              <button
                onClick={() => setEditing("new")}
                className="mt-6 inline-flex items-center gap-1.5 h-12 px-6 rounded-full bg-sprout-mint text-white font-semibold"
                data-testid={`section-empty-add-${sectionKey}`}
              >
                <Plus className="w-4 h-4" /> Add {schema.singular}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3 pb-10">
            {items.map(renderItem)}
            {!isAiBacked && (
              <button
                onClick={() => setEditing("new")}
                className="w-full h-12 rounded-full bg-sprout-mint-soft border border-sprout-mint/40 text-sprout-mint font-semibold flex items-center justify-center gap-1.5"
                data-testid={`section-add-more-${sectionKey}`}
              >
                <Plus className="w-4 h-4" /> Add another
              </button>
            )}
          </div>
        )}
      </Sheet>

      <EntryEditor
        open={!!editing && !isAiBacked}
        sectionKey={sectionKey}
        entry={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />
    </>
  );
}

/* ----------------------- Top-level Professional Profile sheet ----------------------- */

export default function ProfessionalProfileSheet({ open, profile, onClose, onChange }) {
  const [active, setActive] = useState(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Build per-section item lists (read existing + extras)
  const sectionItems = useMemo(() => {
    const extras = profile?.extras || {};
    return {
      experience:     profile?.experience || [],
      volunteer:      extras.volunteer || [],
      projects:       extras.projects || [],
      education:      profile?.education || [],
      skills:         profile?.skills || [],
      certifications: extras.certifications || [],
      awards:         extras.awards || [],
      publications:   extras.publications || [],
      recognition:    extras.recognition || [],
      languages:      extras.languages || [],
      interests:      extras.interests || [],
      references:     extras.references || [],
      key_highlights: extras.key_highlights || [],
      custom:         extras.custom || [],
    };
  }, [profile]);

  const overview = profile?.extras?.overview || {
    role: profile?.target_roles?.[0] || "",
    summary: profile?.summary || "",
  };

  const persistExtras = async (patch) => {
    setSaving(true);
    try {
      const next = { ...(profile?.extras || {}), ...patch };
      await api.patch("/profile/extras", next);
      onChange?.();
    } catch (e) {
      toast.error("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const updateSection = (sectionKey, nextItems) => {
    persistExtras({ [sectionKey]: nextItems });
  };

  const saveOverview = (val) => {
    persistExtras({ overview: typeof val === "string" ? { ...overview, role: val } : val });
  };

  return (
    <Sheet open={open} title="Professional Profile" onClose={onClose} testId="prof-profile-sheet">
      <div className="space-y-7">
        {/* Professional Overview top card */}
        <button
          onClick={() => setOverviewOpen(true)}
          className="w-full flex items-start gap-4 p-5 rounded-2xl border border-sprout-border bg-sprout-surface hover:bg-sprout-surface-2 transition-colors text-left"
          data-testid="prof-overview-card"
        >
          <div className="w-14 h-14 rounded-full bg-sprout-mint-soft-2 grid place-items-center shrink-0">
            <Palette className="w-6 h-6 text-sprout-mint" strokeWidth={1.9} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-white text-xl leading-tight">Your story</h3>
            {overview.role && <p className="mt-1 text-sm text-sprout-muted">{overview.role}</p>}
            {overview.summary && <p className="mt-1.5 text-sm text-sprout-muted line-clamp-2">{overview.summary}</p>}
            {!overview.role && !overview.summary && <p className="mt-1.5 text-sm text-sprout-muted">Add a short bio we'll weave into your cover letters.</p>}
          </div>
          <ChevronRight className="w-5 h-5 text-sprout-muted mt-2 shrink-0" />
        </button>

        {SECTIONS.map((sec) => (
          <section key={sec.group} data-testid={`prof-group-${sec.group}`}>
            <h3 className="text-xs uppercase tracking-[0.18em] text-sprout-muted px-1 mb-3">{sec.group}</h3>
            <div className="space-y-3">
              {sec.rows.map(({ key, icon: Icon, label }) => {
                const items = sectionItems[key] || [];
                const count = items.length;
                return (
                  <button
                    key={key}
                    onClick={() => setActive(key)}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border border-sprout-border bg-sprout-surface hover:bg-sprout-surface-2 transition-colors text-left"
                    data-testid={`prof-row-${key}`}
                  >
                    <div className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${count > 0 ? "bg-sprout-mint-soft-2" : "bg-sprout-surface-2"}`}>
                      <Icon className={`w-5 h-5 ${count > 0 ? "text-sprout-mint" : "text-sprout-muted"}`} strokeWidth={1.9} />
                    </div>
                    <span className="flex-1 font-semibold text-white">{label}</span>
                    {count > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-8 h-7 px-2 rounded-full bg-sprout-mint-soft text-sprout-mint text-sm font-bold" data-testid={`prof-count-${key}`}>{count}</span>
                    ) : (
                      <span className="text-sprout-muted text-sm font-medium">Add</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-sprout-muted" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {saving && (
          <div className="fixed top-20 right-5 z-[80] bg-sprout-surface border border-sprout-border rounded-full px-3 py-1.5 flex items-center gap-2 text-xs text-sprout-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
          </div>
        )}
      </div>

      {/* Per-section detail sheets */}
      {SECTIONS.flatMap((s) => s.rows).map(({ key, label }) => (
        <SectionDetail
          key={key}
          open={active === key}
          sectionKey={key}
          items={sectionItems[key]}
          label={label}
          onClose={() => setActive(null)}
          onChange={(next) => updateSection(key, next)}
        />
      ))}

      <EntryEditor
        open={overviewOpen}
        sectionKey="overview"
        entry={overview.role || overview.summary ? overview : null}
        onClose={() => setOverviewOpen(false)}
        onSave={saveOverview}
      />
    </Sheet>
  );
}
