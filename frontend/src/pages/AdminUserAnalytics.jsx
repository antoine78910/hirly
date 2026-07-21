import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage, autoApplyApiUrl } from "../lib/adminApi";
import {
  ONBOARDING_ANSWER_LABELS,
  fmtDate,
  fmtDuration,
  formatOnboardingAnswerValue,
  onboardingStatusLabel,
} from "../lib/adminUserAnalytics";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

function KpiCard({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold text-zinc-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function AnswerDistributionCard({ step }) {
  const max = step.options[0]?.count || 1;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">{step.title}</h3>
        <span className="shrink-0 text-xs text-zinc-400">{step.total} answers</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {step.options.map((option) => (
          <div key={option.label}>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-600">
              <span className="truncate">{option.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-zinc-800">{option.count} · {option.pct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-linkedin"
                style={{ width: `${Math.max(4, (option.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingAnswersGrid({ answers }) {
  const entries = Object.entries(ONBOARDING_ANSWER_LABELS).filter(
    ([key]) => answers?.[key] !== undefined && answers?.[key] !== null && answers?.[key] !== "",
  );
  if (!entries.length) {
    return <p className="text-sm text-zinc-500">No onboarding answers saved for this user yet.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([key, label]) => (
        <div key={key} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
          <p className="mt-0.5 text-sm font-medium text-zinc-800">{formatOnboardingAnswerValue(key, answers[key])}</p>
        </div>
      ))}
    </div>
  );
}

export default function AdminUserAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data: payload } = await api.get(autoApplyApiUrl("/admin/user-analytics"), {
        timeout: 60000,
        params: { limit: 100, cursor: cursor || undefined, q: debouncedSearch || undefined },
      });
      if (currentRequest !== requestId.current) return;
      setData(payload);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load user analytics"));
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [cursor, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCursor(null);
      setDebouncedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const summary = data?.summary || {};
  const dropoff = data?.onboarding_dropoff || {};
  const dropoffSteps = dropoff.by_step || [];
  const answerDistribution = data?.answer_distributions || [];
  const users = useMemo(() => data?.users || [], [data]);

  useEffect(() => {
    if (expandedId && !users.some((user) => user.user_id === expandedId)) setExpandedId(null);
  }, [expandedId, users]);

  const toggleExpanded = (userId) => {
    setExpandedId((current) => (current === userId ? null : userId));
  };

  return (
    <AdminShell
      title="User Analytics"
      subtitle="Onboarding answers, engagement, swipes, applications, and drop-off points per user."
      actions={(
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {!accessDenied ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total users" value={summary.total_users ?? 0} />
            <KpiCard
              label="Onboarding completed"
              value={summary.onboarding_completed ?? 0}
              hint={`${summary.onboarding_in_progress ?? 0} stuck · ${summary.onboarding_never_started ?? 0} never started`}
            />
            <KpiCard label="Avg time on app" value={fmtDuration(summary.avg_time_spent_minutes)} />
            <KpiCard
              label="Activity"
              value={`${summary.total_swipes ?? 0} swipes`}
              hint={`${summary.total_applications ?? 0} applications sent`}
            />
          </div>

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-zinc-900">Onboarding drop-off</h2>
              <p className="mt-1 text-sm text-zinc-500">Steps where users are currently stuck — ranked by frequency.</p>
            </div>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Step</th>
                  <th className="px-4 py-3">Users stuck</th>
                  <th className="px-4 py-3">Share of incomplete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {loading ? (
                  <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={3}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : dropoffSteps.length ? dropoffSteps.map((row) => (
                  <tr key={row.step}>
                    <td className="px-4 py-3 font-semibold">{row.label}</td>
                    <td className="px-4 py-3">{row.count}</td>
                    <td className="px-4 py-3">
                      {dropoff.in_progress ? `${Math.round((row.count / dropoff.in_progress) * 100)}%` : "—"}
                    </td>
                  </tr>
                )) : (
                  <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={3}>No drop-off data yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="font-display text-lg font-bold text-zinc-900">Most chosen answers</h2>
              <p className="mt-1 text-sm text-zinc-500">For each onboarding step, the answers picked most often across all users.</p>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {loading ? (
                <div className="col-span-full flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
              ) : answerDistribution.length ? answerDistribution.map((step) => (
                <AnswerDistributionCard key={step.key} step={step} />
              )) : (
                <p className="col-span-full text-sm text-zinc-500">No onboarding answers saved yet.</p>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-zinc-900">All users</h2>
                <p className="mt-1 text-sm text-zinc-500">Click a row to see every onboarding answer and activity detail.</p>
              </div>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search email, location, roles…"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm sm:max-w-xs"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1800px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 w-8" />
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Job search</th>
                    <th className="px-4 py-3">Goal</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Contract</th>
                    <th className="px-4 py-3">Roles</th>
                    <th className="px-4 py-3">Salary</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Onboarding</th>
                    <th className="px-4 py-3">Swipes</th>
                    <th className="px-4 py-3">Passed</th>
                    <th className="px-4 py-3">Applications</th>
                    <th className="px-4 py-3">Time on app</th>
                    <th className="px-4 py-3">Last login</th>
                    <th className="px-4 py-3">Last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {loading ? (
                    <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={17}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                  ) : users.length ? users.map((user) => {
                    const answers = user.onboarding_answers || {};
                    const progress = user.onboarding_progress || {};
                    const expanded = expandedId === user.user_id;
                    const salaryLabel = answers.salary_min || answers.salary_max
                      ? `${formatOnboardingAnswerValue("salary_min", answers.salary_min)} – ${formatOnboardingAnswerValue("salary_max", answers.salary_max)}`
                      : "—";
                    return (
                      <Fragment key={user.user_id}>
                        <tr
                          className="cursor-pointer hover:bg-zinc-50"
                          onClick={() => toggleExpanded(user.user_id)}
                        >
                          <td className="px-4 py-3 text-zinc-400">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-zinc-900">{user.email || user.user_id}</span>
                            <p className="mt-0.5 text-xs text-zinc-400">{user.name || "Unknown"}</p>
                          </td>
                          <td className="px-4 py-3 text-zinc-700">{formatOnboardingAnswerValue("job_search_status", answers.job_search_status)}</td>
                          <td className="px-4 py-3 text-zinc-700">{formatOnboardingAnswerValue("job_goal", answers.job_goal)}</td>
                          <td className="px-4 py-3 text-zinc-700">{formatOnboardingAnswerValue("phone", answers.phone)}</td>
                          <td className="px-4 py-3 text-zinc-700">{formatOnboardingAnswerValue("onboarding_location", answers.onboarding_location)}</td>
                          <td className="px-4 py-3 text-zinc-700">{formatOnboardingAnswerValue("contract_type", answers.contract_type)}</td>
                          <td className="max-w-[180px] truncate px-4 py-3 text-zinc-700" title={formatOnboardingAnswerValue("selected_roles", answers.selected_roles)}>
                            {formatOnboardingAnswerValue("selected_roles", answers.selected_roles)}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">{salaryLabel}</td>
                          <td className="px-4 py-3 text-zinc-700">{formatOnboardingAnswerValue("acquisition_source", answers.acquisition_source)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              progress.completed
                                ? "bg-emerald-100 text-emerald-700"
                                : progress.drop_off_step_label
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-zinc-100 text-zinc-500"
                            }`}
                            >
                              {onboardingStatusLabel(progress)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-zinc-800">{user.total_swipes || 0}</span>
                            <p className="mt-0.5 text-xs text-zinc-400">{user.right_swipes || 0} liked</p>
                          </td>
                          <td className="px-4 py-3 text-zinc-700">{user.left_swipes || 0}</td>
                          <td className="px-4 py-3 text-zinc-700">{user.total_applications || 0}</td>
                          <td className="px-4 py-3 text-zinc-700">
                            {fmtDuration(user.time_spent_minutes)}
                            <p className="mt-0.5 text-xs text-zinc-400">{user.sessions_count || 0} sessions</p>
                          </td>
                          <td className="px-4 py-3 text-zinc-600">{fmtDate(user.last_login_at) || "—"}</td>
                          <td className="px-4 py-3 text-zinc-600">{fmtDate(user.last_active_at || user.created_at)}</td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-zinc-50/80">
                            <td colSpan={17} className="px-6 py-5">
                              <div className="space-y-4">
                                <div>
                                  <h3 className="text-sm font-semibold text-zinc-900">Onboarding answers</h3>
                                  <div className="mt-3">
                                    <OnboardingAnswersGrid answers={answers} />
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
                                  <span>CV uploaded: {user.cv_uploaded ? "Yes" : "No"}</span>
                                  <span>Profile: {user.profile_completion || 0}%</span>
                                  <span>Plan: {user.is_premium ? (user.plan || "Paid") : "Free"}</span>
                                  {progress.started_at ? <span>Onboarding started: {fmtDate(progress.started_at)}</span> : null}
                                  {progress.completed_at ? <span>Completed: {fmtDate(progress.completed_at)}</span> : null}
                                  {user.last_swipe_at ? <span>Last swipe: {fmtDate(user.last_swipe_at)}</span> : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  }) : (
                    <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={17}>No users found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="flex items-center justify-between gap-3 text-sm text-zinc-600">
            <span>{data?.total ? `${users.length} shown of ${data.total}` : "0 users"}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data?.previous_cursor || null)}
                disabled={loading || !data?.has_previous || !data?.previous_cursor}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setCursor(data?.next_cursor || null)}
                disabled={loading || !data?.has_next || !data?.next_cursor}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
