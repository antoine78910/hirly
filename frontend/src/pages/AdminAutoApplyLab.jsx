import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import AutoApplyRunConsole from "../components/admin/AutoApplyRunConsole";
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

const fmtDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function AdminAutoApplyLab() {
  const [url, setUrl] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [answersText, setAnswersText] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [showBrowser, setShowBrowser] = useState(false);
  const [running, setRunning] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  const [swipes, setSwipes] = useState([]);
  const [supportedProviders, setSupportedProviders] = useState([]);
  const [swipesLoading, setSwipesLoading] = useState(true);
  const [runningRow, setRunningRow] = useState(null);

  const loadSwipes = useCallback(async () => {
    setSwipesLoading(true);
    try {
      const { data } = await api.get("/admin/auto-apply/right-swipes?limit=150");
      setSwipes(data.swipes || []);
      setSupportedProviders(data.supported_providers || []);
    } catch (err) {
      if (err?.response?.status === 403) setAccessDenied(true);
      else toast.error(adminApiErrorMessage(err, "Could not load right swipes"));
    } finally {
      setSwipesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSwipes();
  }, [loadSwipes]);

  const runForSwipe = async (row, isDryRun) => {
    if (!isDryRun) {
      const confirmed = window.confirm(
        `Submit a REAL application to ${row.company || row.job_id} on behalf of ${row.user_email || row.user_id}?`,
      );
      if (!confirmed) return;
    }
    const key = `${row.user_id}:${row.job_id}`;
    setRunningRow(key);
    setError("");
    setReport(null);
    try {
      const { data } = await api.post(
        "/admin/auto-apply/execute",
        {
          job_id: row.job_id,
          user_id: row.user_id,
          dry_run: isDryRun,
          headless: isDryRun ? true : !showBrowser,
        },
        { timeout: 240000 },
      );
      const result = data.result || data;
      setReport(result);
      toast.success(`${result.status} (stage: ${result.stage_reached}, ${result.duration_ms}ms)`);
      loadSwipes();
    } catch (err) {
      if (err?.response?.status === 403) setAccessDenied(true);
      const message = adminApiErrorMessage(err, "Execution failed");
      setError(message);
      toast.error(message);
    } finally {
      setRunningRow(null);
    }
  };

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
        headless: dryRun ? true : !showBrowser,
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
      title="Auto-Apply Lab"
      subtitle="Replay user right swipes through the production auto-apply pipeline, or validate a pasted job URL."
      actions={(
        <Button variant="outline" onClick={loadSwipes} disabled={swipesLoading}>
          {swipesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : null}
      {error && !accessDenied ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!accessDenied ? (
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-zinc-900">User right swipes</h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={showBrowser}
                  onChange={(e) => setShowBrowser(e.target.checked)}
                />
                Show browser on Apply
              </label>
              <p className="text-xs text-zinc-500">
                Supported ATS: {supportedProviders.length ? supportedProviders.join(", ") : "—"}
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">ATS</th>
                    <th className="px-4 py-3">Last attempt</th>
                    <th className="px-4 py-3">Swiped</th>
                    <th className="px-4 py-3 text-right">Auto apply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {swipesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </td>
                    </tr>
                  ) : swipes.length ? swipes.map((row) => {
                    const key = `${row.user_id}:${row.job_id}`;
                    const isRunning = runningRow === key;
                    const attempt = row.latest_attempt;
                    return (
                      <tr key={key} className="hover:bg-zinc-50">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-zinc-900">{row.user_email || row.user_id}</p>
                          {row.user_name ? <p className="text-xs text-zinc-400">{row.user_name}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-900">{row.title || row.job_id}</p>
                          <p className="text-xs text-zinc-400">{row.company || (row.job_found ? "" : "job no longer in DB")}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="capitalize">{row.ats_provider}</span>
                          <p className={`text-xs font-semibold ${row.driver_supported ? "text-emerald-600" : "text-zinc-400"}`}>
                            {row.driver_supported ? "driver ready" : "no driver"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {attempt ? (
                            <>
                              <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold capitalize text-zinc-700">
                                {String(attempt.status || "").replaceAll("_", " ") || "unknown"}
                              </span>
                              {attempt.reason ? (
                                <p className="mt-1 max-w-[220px] truncate text-xs text-zinc-400" title={attempt.reason}>
                                  {attempt.reason}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-zinc-400">never run</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-600">{fmtDate(row.swiped_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!row.job_found || Boolean(runningRow)}
                              onClick={() => runForSwipe(row, true)}
                            >
                              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                              Dry run
                            </Button>
                            <Button
                              size="sm"
                              disabled={!row.job_found || !row.driver_supported || Boolean(runningRow)}
                              onClick={() => runForSwipe(row, false)}
                            >
                              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                              Apply
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>No right swipes found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <h2 className="mb-3 font-display text-lg font-bold text-zinc-900">URL validation harness</h2>
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

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={showBrowser}
            disabled={dryRun}
            onChange={(e) => setShowBrowser(e.target.checked)}
          />
          Show browser window while filling (real apply only; works on local backend with a display)
        </label>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          Use the run console below after each attempt. If you see
          {" "}
          <code className="rounded bg-zinc-200 px-1">needs_user_input:resume</code>
          , the user application has no tailored CV yet — complete Review first.
        </div>

        <Button type="button" onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : dryRun ? "Run dry run" : "Run REAL submission"}
        </Button>
      </div>

      {report ? (
        <>
          <div className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
            <Stat label="Stage reached" value={report.stage_reached} />
            <Stat label="Status" value={report.status} />
            <Stat label="Verdict" value={report.verdict ?? "—"} />
          </div>
          <AutoApplyRunConsole report={report} />
        </>
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
