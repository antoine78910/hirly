import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage, autoApplyApiUrl } from "../lib/adminApi";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmtDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const PLAN_LABELS = {
  basic: "Basic",
  pro: "Pro",
  ultra: "Ultra",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function PlanBadge({ plan, isPremium }) {
  if (!isPremium) {
    return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">Free</span>;
  }
  const label = PLAN_LABELS[plan] || plan || "Paid";
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{label}</span>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [payingOnly, setPayingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [reconcileEmail, setReconcileEmail] = useState("");
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data } = await api.get(autoApplyApiUrl("/admin/users"), { timeout: 60000 });
      setUsers(data.users || []);
    } catch (err) {
      setUsers([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load users"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const payingCount = useMemo(() => users.filter((user) => user.is_premium).length, [users]);
  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    let rows = payingOnly ? users.filter((user) => user.is_premium) : users;
    if (query) {
      rows = rows.filter((user) => {
        const haystack = [user.email, user.name, user.user_id].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }
    return rows;
  }, [users, payingOnly, search]);

  const repairBillingByEmail = async () => {
    const email = reconcileEmail.trim();
    if (!email) {
      toast.error("Enter the account email");
      return;
    }
    setReconciling(true);
    try {
      const { data } = await api.post("/admin/stripe/repair-by-email", { email });
      toast.success(
        data?.billing?.is_premium
          ? `Repaired ${data.email || data.user_id} — ${data.billing.credits_remaining}/${data.billing.credits_total} credits`
          : `Updated ${data.email || data.user_id}, but subscription is still inactive`,
      );
      setPaymentIntentId("");
      setReconcileEmail("");
      await load();
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not repair billing"));
    } finally {
      setReconciling(false);
    }
  };

  const reconcileStripePayment = async () => {
    const paymentIntent = paymentIntentId.trim();
    const email = reconcileEmail.trim();
    if (!paymentIntent && !email) {
      toast.error("Enter a Stripe ID or an account email");
      return;
    }
    setReconciling(true);
    try {
      const payload = {};
      if (paymentIntent) payload.payment_intent_id = paymentIntent;
      if (email) payload.email = email;
      const { data } = await api.post("/admin/stripe/reconcile", payload);
      toast.success(
        data?.billing?.is_premium
          ? `Linked to ${data.email || data.user_id} — ${data.billing.credits_remaining}/${data.billing.credits_total} credits`
          : `Linked to ${data.email || data.user_id}, but no active subscription found`,
      );
      setPaymentIntentId("");
      setReconcileEmail("");
      await load();
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Could not reconcile Stripe payment"));
    } finally {
      setReconciling(false);
    }
  };

  return (
    <AdminShell
      title="Users"
      subtitle="Account management, billing, and profile status. For onboarding insights see User Analytics."
      actions={(
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPayingOnly((value) => !value)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              payingOnly
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            Paying only ({payingCount})
          </button>
          <Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</Button>
        </div>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {!accessDenied ? (
        <div className="mb-4 space-y-3">
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email, name, or user ID…"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none ring-violet-200 focus:ring-2 sm:max-w-sm"
            />
            <p className="text-xs text-zinc-500 sm:ml-auto">{visibleUsers.length} user(s) shown</p>
          </div>

          <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 shadow-sm">
            <p className="text-sm font-semibold text-violet-900">Link orphan Stripe payment</p>
            <p className="mt-1 text-xs text-violet-700">
              Repair billing by email, or paste a Stripe ID (pi_…, cs_…, cus_…) when you have it.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={reconcileEmail}
                  onChange={(event) => setReconcileEmail(event.target.value)}
                  placeholder="Account email"
                  className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none ring-violet-200 focus:ring-2 sm:max-w-xs"
                />
                <button
                  type="button"
                  onClick={repairBillingByEmail}
                  disabled={reconciling}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 sm:shrink-0"
                >
                  {reconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {reconciling ? "Repairing…" : "Repair by email"}
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={paymentIntentId}
                  onChange={(event) => setPaymentIntentId(event.target.value)}
                  placeholder="Optional Stripe ID (pi_…)"
                  className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none ring-violet-200 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={reconcileStripePayment}
                  disabled={reconciling}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 sm:shrink-0"
                >
                  Link Stripe payment
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!accessDenied ? (
        <div className="max-w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3">CV</th>
                <th className="px-4 py-3">Applications</th>
                <th className="px-4 py-3">Swipes</th>
                <th className="px-4 py-3">Demo</th>
                <th className="px-4 py-3">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={10}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : visibleUsers.length ? visibleUsers.map((user) => (
                <tr key={user.user_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link className="font-semibold text-linkedin hover:underline" to={`/admin/users/${user.user_id}`}>{user.email || user.user_id}</Link>
                    <p className="mt-0.5 text-xs text-zinc-400">{user.user_id}</p>
                  </td>
                  <td className="px-4 py-3">{user.name || "Unknown"}</td>
                  <td className="px-4 py-3"><PlanBadge plan={user.plan} isPremium={user.is_premium} /></td>
                  <td className="px-4 py-3 text-zinc-600">
                    {user.is_premium ? `${user.credits_remaining ?? 0} / ${user.credits_total ?? 0}` : "—"}
                  </td>
                  <td className="px-4 py-3">{user.profile_completion || 0}%</td>
                  <td className="px-4 py-3">{user.cv_uploaded ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{user.total_applications || 0}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-zinc-800">{user.total_swipes || 0}</span>
                    <p className="mt-0.5 text-xs text-zinc-400">{user.right_swipes || 0} right · {user.left_swipes || 0} left</p>
                  </td>
                  <td className="px-4 py-3">{user.demo_account ? "Yes" : "—"}</td>
                  <td className="px-4 py-3">{fmtDate(user.last_active_at || user.created_at)}</td>
                </tr>
              )) : (
                <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={10}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </AdminShell>
  );
}
