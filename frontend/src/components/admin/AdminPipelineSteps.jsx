import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const summarizeQuestion = (item) => {
  if (typeof item === "string") return item;
  return (
    item?.label ||
    item?.field_label ||
    item?.question ||
    item?.field_name ||
    item?.name ||
    "Unknown field"
  );
};

const stepTone = (state) => {
  if (state === "done") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "current") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "blocked") return "border-orange-200 bg-orange-50 text-orange-900";
  return "border-zinc-200 bg-zinc-50 text-zinc-500";
};

/** Build pipeline steps for admin list/detail from an application row. */
export function buildAdminPipelineSteps(app = {}) {
  const packageReady = ["generated", "generated_text_only"].includes(app.package_status);
  const queueStatus = app.auto_apply_queue_status;
  const missing = Array.isArray(app.prepared_missing_information)
    ? app.prepared_missing_information
    : [];
  const needsInfo =
    (app.manual_status === "needs_user_input" ||
      app.user_facing_submission_status === "action_required" ||
      app.submission_status === "action_required" ||
      missing.length > 0) &&
    app.submission_status !== "submitted";
  const submitted =
    app.submission_status === "submitted" ||
    app.manual_status === "manually_submitted" ||
    app.user_facing_submission_status === "submitted" ||
    queueStatus === "succeeded";

  const queueDone =
    submitted || ["succeeded", "failed", "skipped", "running"].includes(queueStatus);
  const queueCurrent = ["queued", "awaiting_review", "running"].includes(queueStatus);

  return [
    {
      key: "package",
      label: "Package",
      state: packageReady || submitted || queueCurrent || needsInfo ? "done" : "todo",
      detail: packageReady ? "Generated" : "Pending",
    },
    {
      key: "queue",
      label: "Queue",
      state:
        submitted || queueStatus === "succeeded"
          ? "done"
          : queueCurrent
            ? "current"
            : queueStatus === "failed" && needsInfo
              ? "blocked"
              : queueStatus
                ? "done"
                : packageReady
                  ? "todo"
                  : "todo",
      detail: queueStatus ? String(queueStatus).replaceAll("_", " ") : "—",
    },
    {
      key: "info",
      label: "Info request",
      state: needsInfo ? "blocked" : submitted || queueDone ? "done" : "todo",
      detail: needsInfo
        ? `${missing.length || "?"} question${missing.length === 1 ? "" : "s"}`
        : "None",
      missing,
      expandable: needsInfo && missing.length > 0,
    },
    {
      key: "sent",
      label: "Sent",
      state: submitted ? "done" : "todo",
      detail: submitted ? (app.submitted_at ? "Submitted" : "Yes") : "Not yet",
    },
  ];
}

export function AdminPipelineSteps({ application, compact = false }) {
  const steps = useMemo(() => buildAdminPipelineSteps(application), [application]);
  const [openInfo, setOpenInfo] = useState(false);
  const infoStep = steps.find((s) => s.key === "info");

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"} data-testid="admin-pipeline-steps">
      <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "gap-2"}`}>
        {steps.map((step) => {
          const clickable = step.key === "info" && step.expandable;
          const Tag = clickable ? "button" : "span";
          return (
            <Tag
              key={step.key}
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => setOpenInfo((v) => !v) : undefined}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${stepTone(step.state)} ${
                clickable ? "cursor-pointer hover:opacity-90" : ""
              }`}
              data-testid={`admin-pipeline-${step.key}`}
            >
              {step.label}
              <span className="font-normal opacity-80">· {step.detail}</span>
              {clickable ? (
                openInfo ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )
              ) : null}
            </Tag>
          );
        })}
      </div>
      {openInfo && infoStep?.missing?.length ? (
        <div
          className="rounded-lg border border-orange-200 bg-orange-50/80 p-2.5 text-xs text-orange-950"
          data-testid="admin-pipeline-info-detail"
        >
          <p className="font-semibold">Information requested from the candidate</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {infoStep.missing.map((item, index) => (
              <li key={index}>
                <span className="font-medium">{summarizeQuestion(item)}</span>
                {item?.field_type || item?.type ? (
                  <span className="text-orange-800/80">
                    {" "}
                    · type: {item.field_type || item.type}
                  </span>
                ) : null}
                {Array.isArray(item?.options) && item.options.length ? (
                  <span className="text-orange-800/80">
                    {" "}
                    · options: {item.options.slice(0, 6).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
