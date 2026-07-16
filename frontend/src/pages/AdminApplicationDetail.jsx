import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import { trackEvent } from "../lib/analytics";

const ACTIONS = [
  { status: "submitted", label: "Mark Submitted" },
  { status: "needs_user_input", label: "Needs User Input" },
  { status: "blocked", label: "Blocked" },
  { status: "escalated", label: "Escalated" },
];

const MANUAL_ACTIONS = [
  { status: "manual_review_needed", label: "Mark Needs Human Completion" },
  { status: "manual_in_progress", label: "Start Manual Completion" },
  { status: "manually_submitted", label: "Mark Manually Submitted" },
  { status: "needs_user_input", label: "Mark Needs User Input" },
  { status: "manual_blocked", label: "Mark Manual Blocked" },
  { status: "offer_expired", label: "Mark Offer Expired (refunds 1 credit)" },
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

const stringifyForCopy = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};

const downloadErrorMessage = async (err) => {
  const payload = err?.response?.data;
  if (payload instanceof Blob) {
    try {
      const parsed = JSON.parse(await payload.text());
      return parsed?.detail || "Download failed";
    } catch {
      return "Download failed";
    }
  }
  return payload?.detail || "Download failed";
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
  const [accessDenied, setAccessDenied] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState("");
  const [updatingManualStatus, setUpdatingManualStatus] = useState("");
  const [assigning, setAssigning] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const openedTrackedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const response = await api.get(`/admin/applications/${id}`);
      setData(response.data);
      if (!openedTrackedRef.current) {
        openedTrackedRef.current = true;
        trackEvent("admin_application_opened", {
          application_id: id,
          status: response.data?.application?.submission_status,
          ats_provider: response.data?.job?.ats_provider,
        });
      }
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load application"));
      }
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
  const contact = useMemo(() => data?.user_contact_info || {}, [data]);
  const defaults = useMemo(() => data?.application_defaults || {}, [data]);
  const resolvedAnswers = useMemo(() => asList(data?.resolved_answers), [data]);
  const notes = useMemo(() => asList(data?.latest_notes), [data]);
  const questions = useMemo(() => asList(data?.required_questions), [data]);
  const missing = useMemo(() => asList(data?.prepared_missing_information), [data]);
  const runs = useMemo(() => asList(data?.browser_submission_runs), [data]);
  const coverLetterText = data?.cover_letter_text || "";
  const tailoredResumeText = data?.tailored_resume_text || "";

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
      trackEvent("admin_status_updated", { application_id: id, status });
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update status");
    } finally {
      setUpdatingStatus("");
    }
  };

  const updateManualStatus = async (manualStatus) => {
    setUpdatingManualStatus(manualStatus);
    try {
      await api.post(`/admin/applications/${id}/manual-status`, {
        manual_status: manualStatus,
        note: note.trim() || undefined,
      });
      if (note.trim()) setNote("");
      toast.success("Manual status updated");
      trackEvent("admin_status_updated", { application_id: id, manual_status: manualStatus });
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update manual status");
    } finally {
      setUpdatingManualStatus("");
    }
  };

  const copyText = async (label, value) => {
    const text = stringifyForCopy(value);
    if (!text) {
      toast.error(`No ${label} available`);
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const downloadAdminFile = async (kind) => {
    try {
      const response = await api.get(`/admin/applications/${id}/${kind}`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = kind === "original-cv"
        ? (docs.original_cv_filename || "original_cv")
        : kind === "tailored-cv" ? "tailored_cv.docx" : "cover_letter.txt";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await downloadErrorMessage(err));
    }
  };

  const sendApplicationEmail = async () => {
    setSendingEmail(true);
    try {
      const response = await api.post(`/admin/applications/${id}/send-email`, {});
      toast.success(`Application email sent via ${response.data?.transport || "email"}`);
      trackEvent("admin_application_email_sent", { application_id: id, transport: response.data?.transport });
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send application email");
    } finally {
      setSendingEmail(false);
    }
  };

  const updateAssignment = async (action) => {
    setAssigning(action);
    try {
      await api.post(`/admin/applications/${id}/${action}`);
      toast.success(action === "assign" ? "Assigned to you" : "Unassigned");
      if (action === "assign") {
        trackEvent("admin_application_assigned", { application_id: id });
      }
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update assignment");
    } finally {
      setAssigning("");
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
      <AdminShell title="Application Detail">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-linkedin" to="/admin/applications">
          <ArrowLeft className="h-4 w-4" /> Back to queue
        </Link>
        {accessDenied ? (
          <div className="mt-6"><AdminAccessDenied /></div>
        ) : (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        )}
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title={job.title || "Application"}
      subtitle={job.company || "Unknown company"}
    >
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

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Section title="Manual completion panel">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Button
                variant="outline"
                disabled={!data?.job_application_url}
                onClick={() => window.open(data.job_application_url, "_blank", "noopener,noreferrer")}
              >
                Open job application URL
              </Button>
              <Button variant="outline" onClick={() => copyText("user info", contact)}>Copy user info</Button>
              <Button variant="outline" onClick={() => downloadAdminFile("original-cv")} disabled={!docs.original_cv_available}>
                Download original CV
              </Button>
              <Button variant="outline" onClick={() => downloadAdminFile("tailored-cv")} disabled={!docs.tailored_cv_available}>
                Download tailored CV
              </Button>
              <Button variant="outline" onClick={() => downloadAdminFile("cover-letter")} disabled={!docs.cover_letter_available}>
                Download cover letter
              </Button>
              <Button variant="outline" onClick={() => copyText("cover letter", coverLetterText)} disabled={!coverLetterText}>
                Copy cover letter text
              </Button>
              <Button variant="outline" onClick={() => copyText("tailored resume", tailoredResumeText)} disabled={!tailoredResumeText}>
                Copy tailored CV text
              </Button>
              <Button onClick={sendApplicationEmail} disabled={!job.contact_email || sendingEmail}>
                {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send application by email
              </Button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Job URL</p>
                <p className="mt-1 break-all text-sm text-zinc-700">{data?.job_application_url || "Not available"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Manual status</p>
                <p className="mt-1 text-sm capitalize text-zinc-700">{app.manual_status || app.admin_status || "Not set"}</p>
              </div>
            </div>
            {data?.failure_classification ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4" data-testid="admin-failure-classification">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Detected issue</p>
                <p className="mt-1 text-sm font-bold text-red-900">{data.failure_classification.admin_title}</p>
                <p className="mt-1 text-sm text-red-800">
                  Code: <span className="font-mono">{data.failure_classification.code}</span>
                  {data.failure_classification.source ? ` · Source: ${data.failure_classification.source}` : ""}
                </p>
                {data.failure_classification.admin_detail ? (
                  <p className="mt-2 text-sm text-red-800">{data.failure_classification.admin_detail}</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Recruiter contact" value={job.contact_name} />
              <Field label="Recruiter email" value={job.contact_email} />
              <Field label="Recruiter phone" value={job.contact_phone} />
            </div>
            {app.application_email_sent_at ? (
              <p className="mt-3 text-xs text-zinc-500">
                Application email sent to {app.application_email_sent_to} on {fmtDate(app.application_email_sent_at)}.
              </p>
            ) : null}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold">Resolved answers</h3>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
                  {stringifyForCopy(resolvedAnswers) || "None recorded."}
                </pre>
              </div>
              <div>
                <h3 className="text-sm font-bold">Application defaults</h3>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
                  {stringifyForCopy(defaults) || "None recorded."}
                </pre>
              </div>
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-bold">Automation failure/log summary</h3>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
                {stringifyForCopy(data?.latest_browser_logs || runs.slice(0, 5)) || app.submission_error || "No automation failure recorded."}
              </pre>
            </div>
          </Section>

          <Section title="A. User">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="User" value={app.user_id} />
              <Field label="Email" value={app.user_email} />
              <Field label="Submission email" value={app.submission_contact_email || "Unknown"} />
              <Field label="Contact name" value={contact.name} />
              <Field label="Phone" value={contact.phone} />
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
            <div className="mb-4 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
              <p className="font-semibold">Assignment</p>
              <p className="mt-1">{app.assigned_to ? `${app.assigned_to} at ${fmtDate(app.assigned_at)}` : "Unassigned"}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => updateAssignment("assign")} disabled={Boolean(assigning)}>
                  {assigning === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Assign to me
                </Button>
                <Button variant="outline" onClick={() => updateAssignment("unassign")} disabled={Boolean(assigning)}>
                  {assigning === "unassign" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Unassign
                </Button>
              </div>
            </div>
            <div className="mb-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Manual completion</p>
              {MANUAL_ACTIONS.map((action) => (
                <Button
                  key={action.status}
                  variant={action.status === "manually_submitted" ? "default" : "outline"}
                  className="w-full justify-center"
                  onClick={() => updateManualStatus(action.status)}
                  disabled={Boolean(updatingManualStatus)}
                >
                  {updatingManualStatus === action.status ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {action.label}
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Legacy status</p>
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
      </div>
    </AdminShell>
  );
}
