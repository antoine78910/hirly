import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data } = await api.get("/admin/users");
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
  const visibleUsers = useMemo(
    () => (payingOnly ? users.filter((user) => user.is_premium) : users),
    [users, payingOnly],
  );

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
