const STAGES = ["driver", "inspect", "classify", "resolve", "plan", "submit", "verify"];

const STATUS_STYLES = {
  ok: "text-emerald-400",
  resolved: "text-emerald-400",
  missing: "text-amber-400",
  optional_skipped: "text-zinc-500",
  not_found: "text-red-400",
  error: "text-red-400",
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
  if (dataAvailability?.tailored_cv_file) return null;
  return "No tailored CV on this application. The user must complete Review (tailored CV) before auto-apply can upload a resume.";
}

export default function AutoApplyRunConsole({ report }) {
  if (!report) return null;

  const debug = report.debug || {};
  const reached = stageIndex(report.stage_reached);
  const execution = debug.execution || {};
  const stepLog = execution.step_log || [];
  const planSteps = debug.plan_steps || [];
  const fieldStatus = debug.field_status || [];
  const dataAvailability = debug.data_availability || {};

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-zinc-900">Run console</h2>
        <p className="text-xs text-zinc-500">
          {report.duration_ms != null ? `${report.duration_ms} ms` : ""}
          {report.driver_version ? ` · ${report.driver_version}` : ""}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-lg">
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {STAGES.map((stage, index) => {
              const done = reached >= index;
              const current = report.stage_reached === stage;
              return (
                <span
                  key={stage}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                    current
                      ? "bg-violet-500 text-white"
                      : done
                        ? "bg-emerald-900/60 text-emerald-300"
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

        <div className="max-h-[70vh] overflow-y-auto p-4 font-mono text-xs text-zinc-100">
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
              <LogLine level="info">Dry run — browser was not opened. Uncheck dry run to watch the form fill.</LogLine>
            </Section>
          ) : report.stage_reached === "resolve" ? (
            <Section title="Browser execution log">
              <LogLine level="warn">Stopped at resolve — fix missing fields above before the browser opens.</LogLine>
            </Section>
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
