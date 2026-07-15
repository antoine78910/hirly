import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import { Button } from "../components/ui/button";

// Minimal end-to-end validation harness (admin only). Paste a Greenhouse job
// URL, attach a resume + cover letter, provide any extra answers, then run the
// real production pipeline (execute_application) and read the ExecutionReport.
// Deliberately unpolished -- this exists to prove the engine, not to be a UI.

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export default function AdminAutoApplyLab() {
  const [url, setUrl] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [answersText, setAnswersText] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  const run = async () => {
    setError("");
    setReport(null);
    if (!url.trim()) {
      toast.error("Paste a Greenhouse job URL first");
      return;
    }
    let additionalAnswers = {};
    if (answersText.trim()) {
      try {
        additionalAnswers = JSON.parse(answersText);
      } catch {
        toast.error("Additional answers must be valid JSON");
        return;
      }
    }
    setRunning(true);
    try {
      const payload = {
        greenhouse_url: url.trim(),
        dry_run: dryRun,
        additional_answers: additionalAnswers,
      };
      if (resumeFile) {
        payload.resume_b64 = await fileToBase64(resumeFile);
        payload.resume_filename = resumeFile.name;
      }
      if (coverFile) {
        payload.cover_letter_text = await fileToText(coverFile);
      }
      const { data } = await api.post("/admin/auto-apply-lab/execute", payload, { timeout: 180000 });
      setReport(data);
      toast.success(`${data.status} (stage: ${data.stage_reached}, ${data.duration_ms}ms)`);
    } catch (err) {
      if (err?.response?.status === 403) {
        setAccessDenied(true);
      }
      setError(adminApiErrorMessage(err, "Execution failed"));
      toast.error(adminApiErrorMessage(err, "Execution failed"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <AdminShell
      title="Auto-Apply Validation"
      subtitle="Run one real Greenhouse application through the production pipeline (admin only)."
    >
      {accessDenied ? <AdminAccessDenied /> : null}
      {error && !accessDenied ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="max-w-2xl space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800">Greenhouse job URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://boards.greenhouse.io/company/jobs/1234567"
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Resume</label>
            <input type="file" onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-zinc-700" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Cover letter (text file)</label>
            <input type="file" accept=".txt,text/plain" onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-zinc-700" />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800">
            Additional answers (JSON, optional) — e.g. {'{"salary": "100000", "visa_status": "Citizen"}'}
          </label>
          <textarea
            value={answersText}
            onChange={(e) => setAnswersText(e.target.value)}
            rows={4}
            placeholder='{"portfolio": "https://...", "salary": "100000"}'
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-900"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          Dry run (inspect + classify + resolve + plan, but do NOT submit)
        </label>

        <Button type="button" onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : dryRun ? "Run dry run" : "Run REAL submission"}
        </Button>
      </div>

      {report ? (
        <div className="mt-6 max-w-3xl space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Stage reached" value={report.stage_reached} />
            <Stat label="Status" value={report.status} />
            <Stat label="Verdict" value={report.verdict ?? "—"} />
            <Stat label="Driver version" value={report.driver_version ?? "—"} />
            <Stat label="Blueprint signature" value={report.blueprint_signature ?? "—"} />
            <Stat label="Duration" value={report.duration_ms != null ? `${report.duration_ms} ms` : "—"} />
          </div>

          {Array.isArray(report.missing_fields) && report.missing_fields.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold">Missing fields (needs user input):</p>
              <ul className="mt-1 list-disc pl-5">
                {report.missing_fields.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          ) : null}

          {Array.isArray(report.screenshots) && report.screenshots.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Screenshot</p>
              <img alt="submission screenshot" src={`data:image/jpeg;base64,${report.screenshots[0]}`}
                className="rounded-lg border border-zinc-200" />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Full ExecutionReport</p>
            <pre className="max-h-[520px] overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100 whitespace-pre-wrap">
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 break-all font-display text-sm font-bold text-zinc-900">{value}</p>
    </div>
  );
}
