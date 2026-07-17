import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import {
  adminApiErrorMessage,
  autoApplyApiUrl,
  isRequestTimeoutError,
  isTransientNetworkError,
  syntheticAutoApplyErrorReport,
  withNetworkRetries,
} from "../lib/adminApi";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import AutoApplyRunPanel from "../components/admin/AutoApplyRunPanel";
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

function notifyRunResult(result) {
  const failed = new Set(["error", "submit_failed", "verification_failed", "unsupported", "needs_user_input"]);
  if (failed.has(result?.status)) {
    toast.error(result.reason?.replaceAll("_", " ") || result.error?.message || "Auto-apply failed");
    return;
  }
  if (result?.status === "in_flight") return;
  toast.success(`${result.status} (stage: ${result.stage_reached}, ${result.duration_ms}ms)`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attemptIsForThisRun(attempt, startedAt) {
  if (!attempt || !startedAt) return false;
  const claimed = attempt.claimed_at || attempt.created_at || "";
  const updated = attempt.updated_at || "";
  return claimed >= startedAt || updated >= startedAt;
}

function reportFromAttempt(attempt) {
  if (attempt?.execution_report && typeof attempt.execution_report === "object") {
    return attempt.execution_report;
  }
  return {
    status: attempt?.status || "error",
    stage_reached: attempt?.stage_reached || "driver",
    reason: attempt?.reason || "Run finished without a detailed report",
    verdict: attempt?.verdict || null,
    missing_fields: attempt?.missing_fields || [],
    driver_version: attempt?.driver_version || null,
    blueprint_signature: attempt?.blueprint_signature || null,
    debug: {
      timeline: [{
        stage: attempt?.stage_reached || "driver",
        status: attempt?.status === "in_flight" ? "ok" : "error",
        detail: attempt?.reason || attempt?.status || "—",
      }],
      execution: attempt?.evidence || null,
    },
    error: attempt?.status === "error"
      ? { message: attempt?.reason || "Execution failed", phase: attempt?.stage_reached || "execute" }
      : null,
  };
}

/**
 * Start execute (returns immediately) then poll status until the background
 * browser run finishes — avoids Railway gateway 502 on long proxy retries.
 * Uses direct Railway API in production (bypasses Vercel rewrite drops).
 */
async function runAutoApplyWithPolling({ jobId, userId, dryRun }) {
  const start = await withNetworkRetries(async () => {
    const { data } = await api.post(
      autoApplyApiUrl("/admin/auto-apply/execute"),
      {
        job_id: jobId,
        user_id: userId,
        dry_run: dryRun,
        // Always headed (local Chrome / Railway Xvfb). Backend also forces headed.
        headless: false,
      },
      { timeout: 60000 },
    );
    return data;
  });

  if (!start?.polling && start?.result && start.result.status !== "in_flight") {
    return start.result;
  }

  const startedAt = start?.started_at || new Date().toISOString();
  const pollUserId = start?.user_id || userId;
  // Driver proxy retries are capped server-side (~3 min); keep a buffer for inspect/fill.
  const deadline = Date.now() + 6 * 60 * 1000;
  let consecutiveNetworkErrors = 0;

  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const { data } = await api.get(autoApplyApiUrl("/admin/auto-apply/status"), {
        params: { job_id: jobId, user_id: pollUserId },
        // Keep short: Chromium can starve the event loop; long timeouts just delay the next poll.
        timeout: 15000,
      });
      consecutiveNetworkErrors = 0;
      const attempt = data?.attempt;
      if (!attemptIsForThisRun(attempt, startedAt)) continue;
      if (attempt.status === "in_flight" && !attempt.execution_report) continue;
      return reportFromAttempt(attempt);
    } catch (err) {
      // Timeouts mean "status slow right now" — keep polling until the deadline.
      if (isRequestTimeoutError(err)) continue;
      if (isTransientNetworkError(err)) {
        consecutiveNetworkErrors += 1;
        if (consecutiveNetworkErrors >= 20) throw err;
        continue;
      }
      throw err;
    }
  }

  throw Object.assign(
    new Error("Auto-apply is still running after 6 minutes. Check Railway logs or refresh status."),
    { code: "ECONNABORTED" },
  );
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
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleRunning, setConsoleRunning] = useState(false);
  const [consoleLabel, setConsoleLabel] = useState("");

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

  const beginConsole = (label) => {
    setConsoleOpen(true);
    setConsoleRunning(true);
    setConsoleLabel(label);
    setReport(null);
    setError("");
  };

  const finishConsole = (nextReport) => {
    setReport(nextReport);
    setConsoleRunning(false);
  };

  const runForSwipe = async (row, isDryRun) => {
    const key = `${row.user_id}:${row.job_id}`;
    setRunningRow(key);
    beginConsole(
      isDryRun
        ? `Dry run · ${row.company || row.title || row.job_id}`
        : `Apply · ${row.company || row.title || row.job_id}`,
    );
    try {
      const result = await runAutoApplyWithPolling({
        jobId: row.job_id,
        userId: row.user_id,
        dryRun: isDryRun,
      });
      finishConsole(result);
      notifyRunResult(result);
      loadSwipes();
    } catch (err) {
      if (err?.response?.status === 403) setAccessDenied(true);
      const message = adminApiErrorMessage(err, "Execution failed");
      setError(message);
      finishConsole(syntheticAutoApplyErrorReport(err, message));
      toast.error(message);
    } finally {
      setRunningRow(null);
    }
  };

  const run = async () => {
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
    beginConsole(dryRun ? "Dry run · URL harness" : "Apply · URL harness");
    try {
      const payload = {
        greenhouse_url: url.trim(),
        dry_run: dryRun,
        headless: false,
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
      finishConsole(data);
      notifyRunResult(data);
    } catch (err) {
      if (err?.response?.status === 403) {
        setAccessDenied(true);
      }
      const message = adminApiErrorMessage(err, "Execution failed");
      setError(message);
      finishConsole(syntheticAutoApplyErrorReport(err, message));
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <AdminShell
      title="Auto-Apply Lab"
      subtitle="Replay user right swipes through the production auto-apply pipeline, or validate a pasted job URL."
      actions={(
        <>
          {report && !consoleOpen ? (
            <Button variant="outline" onClick={() => setConsoleOpen(true)}>
              <Terminal className="h-4 w-4" />
              Open console
            </Button>
          ) : null}
          <Button variant="outline" onClick={loadSwipes} disabled={swipesLoading}>
            {swipesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : null}
      {error && !accessDenied && !consoleOpen ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!accessDenied ? (
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-zinc-900">User right swipes</h2>
            <p className="text-xs text-zinc-500">
              Supported ATS: {supportedProviders.length ? supportedProviders.join(", ") : "—"}
            </p>
          </div>
          {swipesLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading right swipes…
            </div>
          ) : swipes.length === 0 ? (
            <p className="text-sm text-zinc-500">No right swipes found yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">ATS</th>
                    <th className="px-3 py-2">Last run</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {swipes.map((row) => {
                    const key = `${row.user_id}:${row.job_id}`;
                    const busy = runningRow === key;
                    return (
                      <tr key={key} className="border-t border-zinc-100">
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{fmtDate(row.created_at)}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-zinc-900">{row.user_name || row.user_email || row.user_id}</div>
                          <div className="text-xs text-zinc-400">{row.user_email}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-zinc-900">{row.title || row.job_id}</div>
                          <div className="text-xs text-zinc-400">{row.company}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={row.driver_supported ? "text-emerald-700" : "text-amber-700"}>
                            {row.ats_provider || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-500">
                          {row.latest_attempt
                            ? `${row.latest_attempt.status} · ${row.latest_attempt.stage_reached || "—"}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !row.driver_supported}
                              onClick={() => runForSwipe(row, true)}
                            >
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                              Dry run
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy || !row.driver_supported}
                              onClick={() => runForSwipe(row, false)}
                            >
                              Apply
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {!accessDenied ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-display text-lg font-bold text-zinc-900">URL harness</h2>
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="https://boards.greenhouse.io/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <label className="text-sm text-zinc-600">
                Resume
                <input type="file" className="mt-1 block text-xs" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} />
              </label>
              <label className="text-sm text-zinc-600">
                Cover letter
                <input type="file" className="mt-1 block text-xs" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
              </label>
            </div>
            <textarea
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
              rows={4}
              placeholder='Additional answers JSON, e.g. {"visa":"No"}'
              value={answersText}
              onChange={(e) => setAnswersText(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry run (stop before browser submit)
            </label>
            <Button onClick={run} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run URL harness
            </Button>
          </div>
        </div>
      ) : null}

      <AutoApplyRunPanel
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        running={consoleRunning}
        runLabel={consoleLabel}
        report={report}
      />
    </AdminShell>
  );
}
