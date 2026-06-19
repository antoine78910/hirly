import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "twitter", "other"];

const fmtDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const emptyForm = {
  name: "",
  email: "",
  platform: "instagram",
  handle: "",
  notes: "",
};

export default function AdminInfluencers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [grantingId, setGrantingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data } = await api.get("/admin/influencers");
      setRows(data.influencers || []);
    } catch (err) {
      setRows([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(err?.response?.data?.detail || "Could not load influencers");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createInfluencer = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setCreating(true);
    try {
      await api.post("/admin/influencers", form);
      toast.success("Influencer added");
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add influencer");
    } finally {
      setCreating(false);
    }
  };

  const grantDemo = async (influencerId) => {
    setGrantingId(influencerId);
    try {
      const { data } = await api.post(`/admin/influencers/${influencerId}/grant-demo`);
      toast.success(`Demo enabled for ${data.email || "user"}`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not grant demo account");
    } finally {
      setGrantingId(null);
    }
  };

  return (
    <AdminShell
      title="Influencers"
      subtitle="Track creators and grant demo accounts for screen recordings."
      actions={(
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      )}
    >
      {accessDenied ? (
        <AdminAccessDenied />
      ) : error && !rows.length ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-bold">Add influencer</h2>
            <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={createInfluencer}>
              <input
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                placeholder="Name *"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                placeholder="Hirly email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
              <select
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={form.platform}
                onChange={(e) => setForm((prev) => ({ ...prev, platform: e.target.value }))}
              >
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>{platform}</option>
                ))}
              </select>
              <input
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                placeholder="@handle"
                value={form.handle}
                onChange={(e) => setForm((prev) => ({ ...prev, handle: e.target.value }))}
              />
              <input
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm sm:col-span-2"
                placeholder="Notes"
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
              <Button type="submit" disabled={creating} className="sm:col-span-1">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add influencer
              </Button>
            </form>
          </section>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Creator</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Hirly account</th>
                  <th className="px-4 py-3">Demo</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {loading ? (
                  <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={6}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : rows.length ? rows.map((row) => (
                  <tr key={row.influencer_id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{row.name}</p>
                      {row.notes ? <p className="mt-0.5 text-xs text-zinc-500">{row.notes}</p> : null}
                    </td>
                    <td className="px-4 py-3 capitalize">{row.platform}{row.handle ? ` · ${row.handle}` : ""}</td>
                    <td className="px-4 py-3">{row.linked_email || row.email || "—"}</td>
                    <td className="px-4 py-3">
                      {row.linked_demo_account || row.demo_granted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          <Sparkles className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <span className="text-zinc-400">Not granted</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{fmtDate(row.updated_at)}</td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={grantingId === row.influencer_id || row.linked_demo_account}
                        onClick={() => grantDemo(row.influencer_id)}
                      >
                        {grantingId === row.influencer_id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant demo"}
                      </Button>
                    </td>
                  </tr>
                )) : (
                  <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>No influencers tracked yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
