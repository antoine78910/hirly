import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

const ACTIONS = [
  { status: "submitted", label: "Mark Submitted" },
  { status: "needs_user_input", label: "Needs User Input" },
  { status: "blocked", label: "Blocked" },
  { status: "escalated", label: "Escalated" },
];

const fmtDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const asList = (value) => Array.isArray(value) ? value : [];

const summarizeQuestion = (item) => {
  if (typeof item === "string") return item;
  return item?.label || item?.field_label || item?.field_name || item?.name || JSON.stringify(item);
};

function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-bold text-zinc-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-sm text-zinc-800">{value || "Not available"}</p>
    </div>
  );
}

export default function AdminApplicationDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/admin/applications/${id}`);
      setData(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load application");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const app = useMemo(() => data?.application || {}, [data]);
  const profile = useMemo(() => data?.profile || {}, [data]);
  const job = useMemo(() => data?.job || {}, [data]);
  const docs = useMemo(() => data?.generated_documents_metadata || {}, [data]);
  const notes = useMemo(() => asList(data?.latest_notes), [data]);
  const questions = useMemo(() => asList(data?.required_questions), [data]);
  const missing = useMemo(() => asList(data?.prepared_missing_information), [data]);
  const runs = useMemo(() => asList(data?.browser_submission_runs), [data]);

  const profileSummary = useMemo(() => {
    const parts = [
      profile.summary,
      profile.target_role ? `Target role: ${profile.target_role}` : "",
      profile.target_location ? `Location: ${profile.target_location}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  }, [profile]);

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/admin/applications/${id}/notes`, { note });
      setNote("");
      toast.success("Note added");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add note");
    } finally {
      setSavingNote(false);
    }
  };

  const updateStatus = async (status) => {
    setUpdatingStatus(status);
    try {
      await api.patch(`/admin/applications/${id}/admin-status`, { status });
      toast.success("Status updated");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update status");
    } finally {
      setUpdatingStatus("");
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-zinc-50">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-zinc-50 px-6 py-8">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-linkedin" to="/admin/applications">
          <ArrowLeft className="h-4 w-4" /> Back to queue
        </Link>
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <Link className="inline-flex items-center gap-2 text-sm font-semibold text-linkedin" to="/admin/applications">
            <ArrowLeft className="h-4 w-4" /> Back to queue
          </Link>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm text-zinc-500">{job.company || "Unknown company"}</p>
              <h1 className="font-display text-2xl font-bold">{job.title || "Application"}</h1>
            </div>
            <div className="text-sm text-zinc-500">
              {app.submission_status || "unknown"} / {app.package_status || "unknown"}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Section title="A. User">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="User" value={app.user_id} />
              <Field label="Email" value={app.user_email} />
            </div>
            <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">
              {profileSummary || "No profile summary available."}
            </pre>
          </Section>

          <Section title="B. Documents">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="CV text" value={profile.cv_text ? `${profile.cv_text.length} characters` : "Missing"} />
              <Field label="Tailored CV" value={docs.tailored_cv_available ? "Available" : "Missing"} />
              <Field label="Cover letter" value={docs.cover_letter_available ? "Available" : "Missing"} />
            </div>
            <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
              {(profile.cv_text || "").slice(0, 3000) || "No CV text available."}
            </pre>
          </Section>

          <Section title="C. Questions and Browser Logs">
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold">Missing questions</h3>
                <ul className="mt-2 space-y-2 text-sm text-zinc-700">
                  {missing.length ? missing.map((item, index) => (
                    <li key={index} className="rounded-md bg-zinc-50 p-2">{summarizeQuestion(item)}</li>
                  )) : <li className="text-zinc-500">None recorded.</li>}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-bold">Required questions</h3>
                <ul className="mt-2 space-y-2 text-sm text-zinc-700">
                  {questions.length ? questions.map((item, index) => (
                    <li key={index} className="rounded-md bg-zinc-50 p-2">{summarizeQuestion(item)}</li>
                  )) : <li className="text-zinc-500">None recorded.</li>}
                </ul>
              </div>
            </div>
            <div className="mt-5">
              <h3 className="text-sm font-bold">Browser logs summary</h3>
              <div className="mt-2 space-y-2">
                {runs.length ? runs.map((run) => (
                  <div key={run.run_id} className="rounded-md border border-zinc-100 bg-zinc-50 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{run.provider || "browser"}</span>
                      <span className="text-zinc-500">{fmtDate(run.created_at)}</span>
                    </div>
                    <p className="mt-1 text-zinc-600">
                      Status: {run.status || "unknown"} · CAPTCHA: {run.captcha_required ? "yes" : "no"} · Action required: {run.action_required ? "yes" : "no"}
                    </p>
                    {run.failure_reason ? <p className="mt-1 text-red-600">{run.failure_reason}</p> : null}
                  </div>
                )) : <p className="text-sm text-zinc-500">No browser runs recorded.</p>}
              </div>
            </div>
          </Section>
        </div>

        <aside className="space-y-5">
          <Section title="D. Internal Notes">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add an operator note"
              className="min-h-28 bg-white"
            />
            <Button className="mt-3 w-full" onClick={addNote} disabled={savingNote || !note.trim()}>
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add note
            </Button>
            <div className="mt-4 space-y-3">
              {notes.length ? [...notes].reverse().map((item) => (
                <div key={item.note_id || item.created_at} className="rounded-md bg-zinc-50 p-3 text-sm">
                  <p className="whitespace-pre-wrap text-zinc-800">{item.note}</p>
                  <p className="mt-2 text-xs text-zinc-400">{item.author_email || "operator"} · {fmtDate(item.created_at)}</p>
                </div>
              )) : <p className="text-sm text-zinc-500">No notes yet.</p>}
            </div>
          </Section>

          <Section title="E. Admin Actions">
            <div className="space-y-2">
              {ACTIONS.map((action) => (
                <Button
                  key={action.status}
                  variant={action.status === "submitted" ? "default" : "outline"}
                  className="w-full justify-center"
                  onClick={() => updateStatus(action.status)}
                  disabled={Boolean(updatingStatus)}
                >
                  {updatingStatus === action.status ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {action.label}
                </Button>
              ))}
            </div>
          </Section>
        </aside>
      </main>
    </div>
  );
}
