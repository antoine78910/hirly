import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquare, Sparkles, Star } from "lucide-react";
import { createColumnHelper } from "@tanstack/react-table";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import { Button } from "../components/ui/button";
import AdminDataTable from "../components/admin/AdminDataTable";

const TABS = [
  { id: "users", label: "App users" },
  { id: "creators", label: "Creators" },
];

const fmtDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const beneficialLabel = (value) => {
  if (value === "very") return "Very helpful";
  if (value === "somewhat") return "Somewhat helpful";
  if (value === "not_really") return "Not really";
  return value || "—";
};

const categoryLabel = (value) => {
  if (value === "feature") return "Feature idea";
  if (value === "problem") return "Problem / bug";
  if (value === "other") return "Other";
  return value || "—";
};

function FeedbackDetailPanel({ submission, onClose }) {
  if (!submission) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Feedback detail
            </p>
            <h3 className="font-display text-lg font-bold">
              {submission.user_name || submission.user_email || "Anonymous"}
            </h3>
            <p className="text-sm text-zinc-500">{fmtDate(submission.created_at)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-zinc-700">
          {submission.feedback_type === "training_completion" ? (
            <>
              <p>
                <span className="font-semibold text-zinc-900">Helpful:</span>{" "}
                {beneficialLabel(submission.beneficial)}
              </p>
              <p>
                <span className="font-semibold text-zinc-900">Rating:</span> {submission.rating}/5
              </p>
              <p>
                <span className="font-semibold text-zinc-900">Course:</span> {submission.course_id}
              </p>
            </>
          ) : (
            <p>
              <span className="font-semibold text-zinc-900">Category:</span>{" "}
              {categoryLabel(submission.category)}
            </p>
          )}
          <p>
            <span className="font-semibold text-zinc-900">User ID:</span>{" "}
            {submission.user_id || "—"}
          </p>
          <p>
            <span className="font-semibold text-zinc-900">Email:</span>{" "}
            {submission.user_email || "—"}
          </p>
          <div className="rounded-lg bg-zinc-50 p-3 whitespace-pre-wrap">
            {submission.message || submission.message_preview || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

const columnHelper = createColumnHelper();

function SuggestionTable({ rows, onSelect, emptyLabel }) {
  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => (row.created_at ? new Date(row.created_at).getTime() : 0), {
        id: "created_at",
        header: "Date",
        cell: (info) => fmtDate(info.row.original.created_at),
      }),
      columnHelper.accessor(
        (row) => `${row.user_name || ""} ${row.user_email || ""} ${row.user_id || ""}`,
        {
          id: "user",
          header: "User",
          cell: (info) => {
            const row = info.row.original;
            return (
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                className="text-left font-medium text-linkedin hover:underline"
              >
                {row.user_name || "—"}
                <span className="block text-xs font-normal text-zinc-500">
                  {row.user_email || row.user_id}
                </span>
              </button>
            );
          },
        },
      ),
      columnHelper.accessor((row) => categoryLabel(row.category), {
        id: "category",
        header: "Category",
        meta: {
          filterVariant: "select",
          filterOptions: [
            { value: "Feature idea", label: "Feature idea" },
            { value: "Problem / bug", label: "Problem / bug" },
            { value: "Other", label: "Other" },
          ],
        },
      }),
      columnHelper.accessor("message_preview", {
        header: "Preview",
        enableSorting: false,
        cell: (info) => info.getValue() || "—",
      }),
    ],
    [onSelect],
  );

  return (
    <AdminDataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      searchPlaceholder="Search by user or preview…"
      emptyMessage={emptyLabel}
      initialSorting={[{ id: "created_at", desc: true }]}
    />
  );
}

function TrainingFeedbackTable({ rows, onSelect }) {
  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => (row.created_at ? new Date(row.created_at).getTime() : 0), {
        id: "created_at",
        header: "Date",
        cell: (info) => fmtDate(info.row.original.created_at),
      }),
      columnHelper.accessor(
        (row) => `${row.user_name || ""} ${row.user_email || ""} ${row.user_id || ""}`,
        {
          id: "creator",
          header: "Creator",
          cell: (info) => {
            const row = info.row.original;
            return (
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                className="text-left font-medium text-linkedin hover:underline"
              >
                {row.user_name || "—"}
                <span className="block text-xs font-normal text-zinc-500">
                  {row.user_email || row.user_id}
                </span>
              </button>
            );
          },
        },
      ),
      columnHelper.accessor((row) => beneficialLabel(row.beneficial), {
        id: "beneficial",
        header: "Helpful",
        meta: {
          filterVariant: "select",
          filterOptions: [
            { value: "Very helpful", label: "Very helpful" },
            { value: "Somewhat helpful", label: "Somewhat helpful" },
            { value: "Not really", label: "Not really" },
          ],
        },
      }),
      columnHelper.accessor("rating", {
        header: "Rating",
        cell: (info) => (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
            <Star className="h-3.5 w-3.5 fill-current" />
            {info.getValue() || "—"}/5
          </span>
        ),
      }),
      columnHelper.accessor("message_preview", {
        header: "Comment",
        enableSorting: false,
        cell: (info) => info.getValue() || "—",
      }),
    ],
    [onSelect],
  );

  return (
    <AdminDataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      searchPlaceholder="Search by creator or comment…"
      emptyMessage="No training completion feedback yet."
      initialSorting={[{ id: "created_at", desc: true }]}
    />
  );
}

export default function AdminFeatures() {
  const [tab, setTab] = useState("users");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [featureRows, setFeatureRows] = useState([]);
  const [trainingRows, setTrainingRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [recovering, setRecovering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setAccessDenied(false);
    try {
      const { data } = await api.get("/admin/feedback", { params: { tab, limit: 100 } });
      if (tab === "creators") {
        setFeatureRows(data.feature_suggestions || []);
        setTrainingRows(data.training_feedback || []);
      } else {
        setFeatureRows(data.feature_suggestions || []);
        setTrainingRows([]);
      }
    } catch (err) {
      setFeatureRows([]);
      setTrainingRows([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
      } else {
        toast.error(adminApiErrorMessage(err, "Could not load feedback"));
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const recoverFromResend = useCallback(async () => {
    setRecovering(true);
    try {
      const { data } = await api.post("/admin/feedback/backfill-resend");
      const imported = Number(data?.imported || 0);
      const scanned = Number(data?.scanned || 0);
      if (imported > 0) {
        toast.success(`Recovered ${imported} feedback item(s) from email history`);
        await load();
      } else if (scanned > 0) {
        toast.message("No new feedback to recover", {
          description: `${scanned} Hirly email(s) were already imported.`,
        });
      } else {
        toast.message("No feedback found in Resend history", {
          description: "Older items may only exist in your Gmail inbox if email delivery failed.",
        });
      }
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not recover feedback from email history"));
    } finally {
      setRecovering(false);
    }
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (submissionId) => {
    setSelectedId(submissionId);
    try {
      const { data } = await api.get(`/admin/feedback/${submissionId}`);
      setSelectedDetail(data.submission || null);
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not load feedback detail"));
      setSelectedId(null);
    }
  };

  return (
    <AdminShell
      title="Features & feedback"
      subtitle="Feature ideas from app users and creators, plus training completion reviews."
      actions={
        <>
          <Button variant="outline" onClick={recoverFromResend} disabled={loading || recovering}>
            {recovering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Recover from email
          </Button>
          <Button variant="outline" onClick={load} disabled={loading || recovering}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        </>
      }
    >
      {accessDenied ? (
        <AdminAccessDenied />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === item.id
                    ? "bg-linkedin text-white"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : tab === "users" ? (
            <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-violet-600" />
                  <div>
                    <h2 className="font-display text-lg font-bold">General user suggestions</h2>
                    <p className="text-sm text-zinc-500">
                      Feature ideas and bug reports from the main app.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4">
                <SuggestionTable
                  rows={featureRows}
                  onSelect={openDetail}
                  emptyLabel="No user feature suggestions yet."
                />
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-violet-600" />
                    <div>
                      <h2 className="font-display text-lg font-bold">
                        Training completion feedback
                      </h2>
                      <p className="text-sm text-zinc-500">
                        Reviews submitted after creators finish the course at 100%.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-4">
                  <TrainingFeedbackTable rows={trainingRows} onSelect={openDetail} />
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-violet-600" />
                    <div>
                      <h2 className="font-display text-lg font-bold">
                        Creator feature suggestions
                      </h2>
                      <p className="text-sm text-zinc-500">
                        Ideas submitted by users with training access.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-4">
                  <SuggestionTable
                    rows={featureRows}
                    onSelect={openDetail}
                    emptyLabel="No creator feature suggestions yet."
                  />
                </div>
              </section>
            </>
          )}
        </div>
      )}

      <FeedbackDetailPanel
        submission={selectedDetail}
        onClose={() => {
          setSelectedId(null);
          setSelectedDetail(null);
        }}
      />
    </AdminShell>
  );
}
