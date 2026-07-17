const STAGES = ["driver", "inspect", "classify", "resolve", "plan", "submit", "verify"];

const STATUS_STYLES = {
  ok: "text-emerald-400",
  resolved: "text-emerald-400",
  missing: "text-amber-400",
  optional_skipped: "text-zinc-500",
  not_found: "text-red-400",
  error: "text-red-400",
  blocked: "text-amber-400",
  warn: "text-amber-400",
};

const TIMELINE_DOT = {
  ok: "bg-emerald-500",
  error: "bg-red-500",
  blocked: "bg-amber-500",
  warn: "bg-amber-400",
};

const FAILURE_HINTS = {
  submit_not_performed: "The submit button was never clicked. Check the browser log below for missing fields or a changed submit selector.",
  submit_button_not_found: "No submit button matched on the page. The ATS form layout may have changed.",
  browser_never_reached_form: "The browser opened but no form steps ran — often a page load failure or login wall.",
  browser_step_errors: "One or more fill/upload steps failed. Expand the browser execution log for details.",
  "blocked:bot_protection": "SmartRecruiters blocked automated access (HTTP 403 / bot wall). Retry later, use a residential proxy, or submit manually.",
  bot_protection: "SmartRecruiters blocked automated access (HTTP 403 / bot wall). Retry later, use a residential proxy, or submit manually.",
  proxy_connect: "Residential proxy could not reach the ATS (HTTP 572). Check BROWSER_PROXY on Railway or retry for a fresh exit IP.",
};

function stageIndex(stage) {
  const idx = STAGES.indexOf(String(stage || "").toLowerCase());
  return idx >= 0 ? idx : -1;
}

function boolLabel(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "—";
}

function hintForMissing(fieldKey, dataAvailability) {
  if (fieldKey !== "resume") return null;
  if (dataAvailability?.tailored_cv_file || dataAvailability?.profile_cv_original) return null;
  return "No CV file on this application or profile. The user must upload a resume before auto-apply can continue.";
}

function blockedHint(report) {
  const reason = report?.reason || report?.debug?.execution?.blocked_reason;
  if (!reason) return null;
  return FAILURE_HINTS[reason] || FAILURE_HINTS[String(reason).replace(/^blocked:/, "")] || null;
}

function resolveError(report) {
  if (report?.error) return report.error;
  if (report?.debug?.error) return report.debug.error;
  if (report?.status === "submit_failed" && report.reason) {
    return {
      phase: "submit",
      message: report.reason.replaceAll("_", " "),
      hint: FAILURE_HINTS[report.reason] || FAILURE_HINTS.submit_not_performed,
    };
  }
  if (report?.status === "unsupported" && report.reason) {
    return {
      phase: "submit",
      message: report.reason.replaceAll("_", " "),
      hint: blockedHint(report),
    };
  }
  return null;
}

function isRunFailed(report) {
  const failedStatuses = new Set(["error", "submit_failed", "verification_failed", "unsupported"]);
  return failedStatuses.has(report?.status) || Boolean(resolveError(report)) || Boolean(blockedHint(report));
}

export default function AutoApplyRunConsole({ report, embedded = false }) {
  if (!report) return null;

  const debug = report.debug || {};
  const runError = resolveError(report);
  const isFailed = isRunFailed(report);
  const reached = stageIndex(report.stage_reached);
  const execution = debug.execution || {};
  const stepLog = execution.step_log || [];
  const planSteps = debug.plan_steps || [];
  const fieldStatus = debug.field_status || [];
  const dataAvailability = debug.data_availability || {};
  const timeline = debug.timeline || [];

  const rootClass = embedded ? "space-y-4" : "mt-6 space-y-4";

  return (
    <div className={rootClass}>
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-zinc-900">Run console</h2>
          <p className="text-xs text-zinc-500">
            {report.duration_ms != null ? `${report.duration_ms} ms` : ""}
            {report.driver_version ? ` · ${report.driver_version}` : ""}
          </p>
        </div>
      ) : null}

      {isFailed ? (
        <ErrorPanel error={runError} reason={report.reason} stage={report.stage_reached} embedded={embedded} />
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-lg">
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {STAGES.map((stage, index) => {
              const done = !isFailed && reached >= index;
              const failedHere = isFailed && report.stage_reached === stage;
              const current = !isFailed && report.stage_reached === stage;
              return (
                <span
                  key={stage}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                    failedHere
                      ? "bg-red-600 text-white"
                      : current
                        ? "bg-violet-500 text-white"
                        : done
                          ? "bg-emerald-900/60 text-emerald-300"
                          : reached > index
                            ? "bg-emerald-900/40 text-emerald-400/80"
                            : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {stage}
                </span>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <ConsoleStat label="Status" value={String(report.status || "").replaceAll("_", " ")} />
            <ConsoleStat label="Stage" value={report.stage_reached} />
            <ConsoleStat label="Reason" value={report.reason || "—"} />
            <ConsoleStat label="Submitted" value={boolLabel(execution.submit_performed)} />
            <ConsoleStat label="Verdict" value={report.verdict || "—"} />
          </div>
        </div>

        <div className={`overflow-y-auto p-4 font-mono text-xs text-zinc-100 ${embedded ? "max-h-none" : "max-h-[70vh]"}`}>
          {timeline.length ? (
            <Section title="Run timeline">
              <div className="space-y-2">
                {timeline.map((entry, index) => (
                  <div key={`${entry.stage}-${index}`} className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TIMELINE_DOT[entry.status] || "bg-zinc-600"}`} />
                    <div>
                      <p className="text-zinc-200">
                        <span className="font-semibold uppercase text-violet-300">{entry.stage}</span>
                        {" · "}
                        <span className={STATUS_STYLES[entry.status] || "text-zinc-400"}>{entry.status}</span>
                      </p>
                      {entry.detail ? <p className="mt-0.5 text-zinc-400">{entry.detail}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {debug.application_url ? (
            <LogLine level="info">
              Application URL:
              {" "}
              <a href={debug.application_url} target="_blank" rel="noreferrer" className="text-sky-400 underline">
                {debug.application_url}
              </a>
            </LogLine>
          ) : null}

          <Section title="Data availability">
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(dataAvailability).map(([key, value]) => (
                <LogLine key={key} level={value ? "ok" : "warn"}>
                  {key}
                  :
                  {" "}
                  {typeof value === "boolean" ? boolLabel(value) : String(value ?? "—")}
                </LogLine>
              ))}
            </div>
          </Section>

          {fieldStatus.length ? (
            <Section title={`Fields (${debug.resolved_count ?? 0} resolved, ${debug.unresolved_count ?? 0} missing)`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="pb-2 pr-3">Field</th>
                      <th className="pb-2 pr-3">Type</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Value</th>
                      <th className="pb-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldStatus.map((row) => {
                      const hint = hintForMissing(row.key, dataAvailability);
                      return (
                        <tr key={row.key} className="border-t border-zinc-800 align-top">
                          <td className="py-2 pr-3">
                            <span className="text-zinc-200">{row.key}</span>
                            {row.label ? <p className="text-zinc-500">{row.label}</p> : null}
                            {hint ? <p className="mt-1 text-amber-400">{hint}</p> : null}
                          </td>
                          <td className="py-2 pr-3 text-zinc-400">{row.type}</td>
                          <td className={`py-2 pr-3 font-semibold ${STATUS_STYLES[row.status] || "text-zinc-300"}`}>
                            {row.status}
                          </td>
                          <td className="py-2 pr-3 text-zinc-300">{row.value_preview || "—"}</td>
                          <td className="py-2 text-zinc-500">{row.source || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : isFailed && report.stage_reached === "inspect" ? (
            <Section title="Fields">
              <LogLine level="error">Inspection failed before fields could be read.</LogLine>
            </Section>
          ) : null}

          {planSteps.length ? (
            <Section title={`Planned steps (${planSteps.length})`}>
              {planSteps.map((step, index) => (
                <LogLine key={`${step.action}-${index}`} level="info">
                  [
                  {index + 1}
                  ]
                  {" "}
                  {step.action}
                  {" → "}
                  {step.locators?.[0] || "(no locator)"}
                  {step.value_preview ? ` · ${step.value_preview}` : ""}
                </LogLine>
              ))}
            </Section>
          ) : null}

          {stepLog.length ? (
            <Section title={`Browser execution log (${stepLog.length})`}>
              {stepLog.map((entry, index) => (
                <LogLine
                  key={`${entry.action}-${index}`}
                  level={entry.status === "ok" ? "ok" : entry.status === "not_found" ? "warn" : "error"}
                >
                  [
                  {index + 1}
                  ]
                  {" "}
                  {entry.action}
                  {" "}
                  <span className={STATUS_STYLES[entry.status] || ""}>{entry.status}</span>
                  {" · "}
                  {entry.locator || "—"}
                  {entry.value_preview ? ` · ${entry.value_preview}` : ""}
                  {entry.error ? ` · ${entry.error}` : ""}
                </LogLine>
              ))}
            </Section>
          ) : report.stage_reached === "submit" || report.stage_reached === "verify" ? (
            <Section title="Browser execution log">
              <LogLine level="warn">No step log recorded (run may have failed before browser steps).</LogLine>
            </Section>
          ) : report.status === "prepared" ? (
            <Section title="Browser execution log">
              <LogLine level="info">Dry run — browser was not opened. Uncheck dry run to submit for real.</LogLine>
            </Section>
          ) : report.stage_reached === "resolve" ? (
            <Section title="Browser execution log">
              <LogLine level="warn">Stopped at resolve — fix missing fields above before the browser opens.</LogLine>
            </Section>
          ) : isFailed && report.stage_reached === "submit" ? (
            <Section title="Browser execution log">
              <LogLine level="error">
                Browser failed to start or load the page. See the error panel above for details.
              </LogLine>
            </Section>
          ) : null}

          {execution.submit_detail ? (
            <LogLine level="error">Submit detail: {String(execution.submit_detail)}</LogLine>
          ) : null}
          {execution.blocked_reason ? (
            <LogLine level="error">Blocked: {execution.blocked_reason}</LogLine>
          ) : null}
          {execution.confirmation_text ? (
            <LogLine level="ok">Confirmation: {execution.confirmation_text}</LogLine>
          ) : null}
          {(execution.validation_errors || []).map((err) => (
            <LogLine key={err} level="error">{err}</LogLine>
          ))}

          {Array.isArray(report.screenshots) && report.screenshots[0] ? (
            <Section title="Screenshot after submit">
              <img
                alt="Auto-apply screenshot"
                src={`data:image/jpeg;base64,${report.screenshots[0]}`}
                className="mt-2 max-w-full rounded-lg border border-zinc-700"
              />
            </Section>
          ) : null}

          <details className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <summary className="cursor-pointer text-zinc-400">Raw ExecutionReport JSON</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-zinc-300">
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({ error, reason, stage, embedded = false }) {
  const message = error?.message || reason || "Unknown error";
  const phase = error?.phase || stage || "execute";

  const panelClass = embedded
    ? "rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-4"
    : "rounded-xl border border-red-200 bg-red-50 px-4 py-4 shadow-sm";

  const titleClass = embedded ? "text-red-100" : "text-red-900";
  const messageClass = embedded ? "text-red-200" : "text-red-800";
  const labelClass = embedded ? "text-red-300/70" : "text-red-700/70";
  const valueClass = embedded ? "text-red-100" : "text-red-900/80";
  const hintClass = embedded
    ? "mt-3 rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-2 text-sm text-red-100"
    : "mt-3 rounded-lg border border-red-200 bg-white/70 px-3 py-2 text-sm text-red-900";

  return (
    <div className={panelClass}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          embedded ? "bg-red-500/20 text-red-200" : "bg-red-100 text-red-700"
        }`}
        >
          !
        </div>
        <div className="min-w-0 flex-1">
          <p className={`font-display text-base font-bold ${titleClass}`}>Run failed at {stage || "unknown"}</p>
          <p className={`mt-1 text-sm font-medium ${messageClass}`}>{message}</p>
          <dl className={`mt-3 grid gap-2 text-xs sm:grid-cols-2 ${valueClass}`}>
            <div>
              <dt className={`font-semibold uppercase tracking-wide ${labelClass}`}>Phase</dt>
              <dd className="font-mono">{phase}</dd>
            </div>
            {error?.exception_class ? (
              <div>
                <dt className={`font-semibold uppercase tracking-wide ${labelClass}`}>Exception</dt>
                <dd className="font-mono">{error.exception_class}</dd>
              </div>
            ) : null}
            {error?.http_status ? (
              <div>
                <dt className={`font-semibold uppercase tracking-wide ${labelClass}`}>HTTP</dt>
                <dd className="font-mono">{error.http_status}</dd>
              </div>
            ) : null}
            {error?.timed_out ? (
              <div>
                <dt className={`font-semibold uppercase tracking-wide ${labelClass}`}>Timed out</dt>
                <dd className="font-mono">yes</dd>
              </div>
            ) : null}
            {error?.target_url ? (
              <div className="sm:col-span-2">
                <dt className={`font-semibold uppercase tracking-wide ${labelClass}`}>Target URL</dt>
                <dd className="break-all font-mono">
                  <a href={error.target_url} target="_blank" rel="noreferrer" className="underline">
                    {error.target_url}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
          {error?.hint ? (
            <p className={hintClass}>
              <span className="font-semibold">What to try: </span>
              {error.hint}
            </p>
          ) : null}
          {error?.traceback ? (
            <details className="mt-3">
              <summary className={`cursor-pointer text-xs font-semibold ${labelClass}`}>Stack trace</summary>
              <pre className={`mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] ${messageClass}`}>
                {error.traceback}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-violet-400">{title}</p>
      {children}
    </div>
  );
}

function LogLine({ level = "info", children }) {
  const color = level === "ok"
    ? "text-emerald-400"
    : level === "warn"
      ? "text-amber-400"
      : level === "error"
        ? "text-red-400"
        : "text-zinc-300";
  return <p className={`mb-1 leading-relaxed ${color}`}>{children}</p>;
}

function ConsoleStat({ label, value }) {
  return (
    <span className="text-zinc-400">
      <span className="text-zinc-500">{label}:</span>
      {" "}
      <span className="font-semibold capitalize text-zinc-100">{value}</span>
    </span>
  );
}
