import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Crown, FileText, Heart, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const BRAND_VIOLET = "#7C3AED";

const fmtDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const fmtDay = (iso) => {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const PLAN_LABELS = {
  basic: "Basic",
  pro: "Pro",
  ultra: "Ultra",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function Section({ title, description, children, className = "" }) {
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="font-display text-lg font-bold text-zinc-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function JsonBlock({ value }) {
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">{JSON.stringify(value || {}, null, 2)}</pre>;
}

function Stat({ label, value, accent = "text-zinc-900" }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-display text-xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function DailyUsageTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-zinc-900">{fmtDay(row?.date)}</p>
      <div className="flex items-center gap-2 text-zinc-600">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: BRAND_VIOLET }} />
        Credits used
        <span className="ml-auto font-semibold tabular-nums text-zinc-900">{row?.count ?? 0}</span>
      </div>
    </div>
  );
}

function DailyUsageChart({ data }) {
  const rows = (data || []).map((row) => ({ ...row, label: fmtDay(row.date) }));
  const maxValue = Math.max(4, ...rows.map((row) => row.count || 0));
  return (
    <div className="h-[220px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 4 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#e4e4e7" strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#71717a" }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} domain={[0, maxValue]} tick={{ fontSize: 11, fill: "#71717a" }} width={28} />
          <Tooltip cursor={{ fill: "rgba(124, 58, 237, 0.1)" }} content={<DailyUsageTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {rows.map((entry) => (
              <Cell key={entry.date} fill={entry.count > 0 ? BRAND_VIOLET : "#e4e4e7"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function statusBadgeClass(status) {
  const key = String(status || "").toLowerCase();
  if (key.includes("submit")) return "bg-emerald-100 text-emerald-700";
  if (key.includes("block") || key.includes("fail")) return "bg-red-100 text-red-700";
  if (key.includes("action")) return "bg-amber-100 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

export default function AdminUserDetail() {
  const { userId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [demoSaving, setDemoSaving] = useState(false);
  const [usageRange, setUsageRange] = useState("14d");
  const [docModal, setDocModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const response = await api.get(`/admin/users/${userId}`);
      setData(response.data);
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load user"));
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const user = useMemo(() => data?.user || {}, [data]);
  const profile = useMemo(() => data?.profile || {}, [data]);
  const applications = useMemo(() => data?.applications || [], [data]);
  const billing = useMemo(() => data?.billing || {}, [data]);
  const swipeSummary = useMemo(() => data?.swipe_summary || {}, [data]);
  const documents = useMemo(() => data?.documents || {}, [data]);
  const statusCounts = useMemo(() => data?.application_status_counts || {}, [data]);
  const outcomeCounts = useMemo(() => data?.outcome_counts || {}, [data]);

  const summary = useMemo(() => {
    return [
      profile.summary,
      profile.cv_text ? `CV text: ${profile.cv_text.length} characters` : "",
      user.profile_completion !== undefined ? `Profile completion: ${user.profile_completion}%` : "",
    ].filter(Boolean).join("\n");
  }, [profile, user.profile_completion]);

  const demoAccount = Boolean(user.demo_account);

  const toggleDemoAccount = async () => {
    setDemoSaving(true);
    try {
      await api.patch(`/admin/users/${userId}/demo-account`, { demo_account: !demoAccount });
      toast.success(demoAccount ? "Demo account disabled" : "Demo account enabled");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update demo account");
    } finally {
      setDemoSaving(false);
    }
  };

  if (loading) {
    return <div className="grid min-h-dvh place-items-center bg-zinc-50"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>;
  }

  const usageSeries = swipeSummary?.daily_usage?.[usageRange] || [];
  const isPremium = Boolean(billing.is_premium);
  const planLabel = PLAN_LABELS[billing.plan] || billing.plan || "Paid";

  return (
    <AdminShell title={user.email || "User Detail"} subtitle={user.name || user.user_id}>
      <Link className="inline-flex items-center gap-2 text-sm font-semibold text-linkedin" to="/admin/users">
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Link>

      {accessDenied ? <div className="mt-6"><AdminAccessDenied /></div> : error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <Section
              title="Billing & credits"
              description={isPremium ? "Paying subscriber — usage as if signed into their account." : "Free account — no active subscription."}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${isPremium ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                  <Crown className="h-3.5 w-3.5" />
                  {isPremium ? planLabel : "Free plan"}
                </span>
                {billing.subscription_status ? (
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium capitalize text-zinc-600">
                    {billing.subscription_status.replaceAll("_", " ")}
                  </span>
                ) : null}
                {billing.interval ? (
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium capitalize text-zinc-600">{billing.interval}</span>
                ) : null}
                {billing.current_period_end ? (
                  <span className="text-xs text-zinc-500">Renews {fmtDate(billing.current_period_end)}</span>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Credits left" value={`${billing.credits_remaining ?? 0}`} accent="text-linkedin" />
                <Stat label="Credits total" value={`${billing.credits_total ?? 0}`} />
                <Stat label="Right swipes" value={swipeSummary.right ?? 0} accent="text-emerald-600" />
                <Stat label="Right swipe rate" value={`${swipeSummary.right_rate ?? 0}%`} />
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-700">Credits spent per day</p>
                  <div className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-0.5">
                    {["7d", "14d", "30d"].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setUsageRange(option)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                          usageRange === option ? "bg-white text-linkedin shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <DailyUsageChart data={usageSeries} />
              </div>

              {swipeSummary.last_swipe_at ? (
                <p className="mt-3 text-xs text-zinc-500">Last swipe {fmtDate(swipeSummary.last_swipe_at)} · {swipeSummary.total ?? 0} swipes total ({swipeSummary.left ?? 0} left / {swipeSummary.right ?? 0} right)</p>
              ) : null}
            </Section>

            <Section title="Profile Summary">
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">{summary || "No profile summary available."}</pre>
            </Section>

            <Section
              title="Documents uploaded"
              description="CV, cover letter and links captured for this account."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => documents.has_cv && setDocModal({ title: documents.cv_filename || "CV", text: documents.cv_preview })}
                  disabled={!documents.has_cv}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    documents.has_cv ? "border-zinc-200 bg-white hover:bg-zinc-50" : "border-zinc-100 bg-zinc-50 text-zinc-400"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>
                      <span className="block font-medium text-zinc-800">{documents.cv_filename || "CV"}</span>
                      <span className="block text-xs text-zinc-500">{documents.has_cv ? `${documents.cv_text_length} characters` : "Not uploaded"}</span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => documents.has_cover_letter && setDocModal({ title: "Cover letter", text: documents.cover_letter_preview })}
                  disabled={!documents.has_cover_letter}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    documents.has_cover_letter ? "border-zinc-200 bg-white hover:bg-zinc-50" : "border-zinc-100 bg-zinc-50 text-zinc-400"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>
                      <span className="block font-medium text-zinc-800">Cover letter</span>
                      <span className="block text-xs text-zinc-500">{documents.has_cover_letter ? `${documents.cover_letter_text_length} characters` : "Not uploaded"}</span>
                    </span>
                  </span>
                </button>
              </div>
              {(documents.linkedin_url || documents.portfolio_url) ? (
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {documents.linkedin_url ? <a href={documents.linkedin_url} target="_blank" rel="noreferrer" className="text-linkedin hover:underline">LinkedIn ↗</a> : null}
                  {documents.portfolio_url ? <a href={documents.portfolio_url} target="_blank" rel="noreferrer" className="text-linkedin hover:underline">Portfolio ↗</a> : null}
                </div>
              ) : null}
            </Section>

            <Section
              title="Applications & follow-up"
              description="Every job this user applied to, with generated documents and outcome tracking."
            >
              {Object.keys(statusCounts).length ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <span key={status} className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(status)}`}>
                      {status.replaceAll("_", " ")} · {count}
                    </span>
                  ))}
                  {Object.entries(outcomeCounts).map(([outcome, count]) => (
                    <span key={outcome} className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold capitalize text-violet-700">
                      <Heart className="mr-1 inline h-3 w-3" />
                      {outcome.replaceAll("_", " ")} · {count}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="space-y-2">
                {applications.length ? applications.map((app) => (
                  <Link key={app.application_id} to={`/admin/applications/${app.application_id}`} className="block rounded-md bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{app.company || "Unknown company"} · {app.title || "Unknown role"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(app.submission_status)}`}>
                        {String(app.submission_status || "unknown").replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                      <span>{fmtDate(app.updated_at || app.created_at)}</span>
                      {app.has_tailored_resume ? <span className="text-emerald-600">CV tailored</span> : null}
                      {app.has_cover_letter ? <span className="text-emerald-600">Cover letter</span> : null}
                      {app.email_confirmed_outcome ? <span className="capitalize text-violet-600">{app.email_confirmed_outcome.replaceAll("_", " ")}</span> : null}
                    </div>
                  </Link>
                )) : <p className="text-sm text-zinc-500">No applications found.</p>}
              </div>
            </Section>
          </div>

          <aside className="space-y-5">
            <Section title="Account flags">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">Demo account</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    Local applies only — no submissions to employers. Unlimited swipes with a 600-credit display cycle.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleDemoAccount}
                  disabled={demoSaving}
                  role="switch"
                  aria-checked={demoAccount}
                  data-testid="admin-demo-account-toggle"
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    demoAccount ? "bg-linkedin" : "bg-zinc-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                      demoAccount ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </Section>
            <Section title="Contact">
              <JsonBlock value={data.contact} />
            </Section>
            <Section title="Preferences">
              <JsonBlock value={data.preferences} />
            </Section>
            <Section title="Application Defaults">
              <JsonBlock value={data.application_defaults} />
            </Section>
            <Section title="Billing (raw)">
              <JsonBlock value={data.billing} />
            </Section>
            <Section title="Internal Notes">
              <p className="text-sm text-zinc-500">User-level internal notes are not enabled yet.</p>
            </Section>
          </aside>
        </div>
      )}

      {docModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDocModal(null)}>
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5">
              <h3 className="font-display text-base font-bold text-zinc-900">{docModal.title}</h3>
              <button type="button" onClick={() => setDocModal(null)} className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-5 text-sm text-zinc-700">{docModal.text || "No content."}</pre>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
