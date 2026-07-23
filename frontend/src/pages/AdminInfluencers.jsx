import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2, Loader2, MonitorPlay, Plus, RefreshCw, Sparkles } from "lucide-react";
import { createColumnHelper } from "@tanstack/react-table";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { buildInviteUrl } from "../lib/creatorInvite";
import {
  formatInviteClicked,
  formatInviteConnectedAccount,
  formatInviteStatus,
} from "../lib/adminInviteTracking";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import AdminDataTable from "../components/admin/AdminDataTable";

const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "twitter", "other"];

const fmtDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const emptyForm = {
  name: "",
  email: "",
  platform: "instagram",
  handle: "",
  notes: "",
};

const columnHelper = createColumnHelper();

async function copyText(label, value) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`);
  }
}

function InviteModal({
  open,
  onClose,
  influencer,
  invite,
  creating,
  onCreate,
  variant = "training",
}) {
  if (!open || !influencer) return null;

  const code = invite?.code || "";
  const inviteUrl = code ? buildInviteUrl(code) : "";
  const isDemo = variant === "demo";
  const title = isDemo ? "Demo account link" : "Training invitation";
  const description = isDemo
    ? "Send this link so they can sign up and get demo-only access for screen recordings."
    : "Send this link so they can sign up and access the creator training program.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
        <h3 className="font-display text-lg font-bold">{title}</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Send this link to <span className="font-semibold text-zinc-900">{influencer.name}</span>{" "}
          {description}
        </p>

        {invite ? (
          <div className="mt-4 space-y-3 rounded-lg bg-zinc-50 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                6-digit code
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-2xl font-bold tracking-[0.2em] text-zinc-900">
                  {code}
                </span>
                <Button size="sm" variant="outline" onClick={() => copyText("Code", code)}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Invitation link
              </p>
              <div className="mt-1 flex items-start gap-2">
                <p className="flex-1 break-all text-sm text-zinc-700">{inviteUrl}</p>
                <Button size="sm" variant="outline" onClick={() => copyText("Link", inviteUrl)}>
                  <Link2 className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              They can open the link on mobile or desktop. On mobile, they can also enter the
              6-digit code at the end of onboarding.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-600">
            Generate a fresh invitation for this creator.
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={creating} onClick={onCreate}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {invite ? "Generate new link" : "Generate invitation"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminInfluencers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [grantingId, setGrantingId] = useState(null);
  const [inviteTarget, setInviteTarget] = useState(null);
  const [inviteVariant, setInviteVariant] = useState("training");
  const [inviteData, setInviteData] = useState(null);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [demoInvites, setDemoInvites] = useState([]);
  const [demoInviteLoading, setDemoInviteLoading] = useState(true);
  const [demoInviteCreating, setDemoInviteCreating] = useState(false);
  const [latestDemoInvite, setLatestDemoInvite] = useState(null);
  const [demoLabel, setDemoLabel] = useState("");
  const [demoEmailHint, setDemoEmailHint] = useState("");

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
        setError(adminApiErrorMessage(err, "Could not load influencers"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDemoInvites = useCallback(async () => {
    setDemoInviteLoading(true);
    try {
      const { data } = await api.get("/admin/demo/invites");
      const rows = data?.invites || [];
      setDemoInvites(rows);
      if (!latestDemoInvite && rows[0]) setLatestDemoInvite(rows[0]);
    } catch (err) {
      if (err?.response?.status !== 403) {
        toast.error(adminApiErrorMessage(err, "Could not load demo invites"));
      }
    } finally {
      setDemoInviteLoading(false);
    }
  }, [latestDemoInvite]);

  useEffect(() => {
    load();
    loadDemoInvites();
  }, [load, loadDemoInvites]);

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

  const grantDemo = useCallback(
    async (influencerId) => {
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
    },
    [load],
  );

  const openInviteModal = useCallback((row, variant = "training") => {
    setInviteTarget(row);
    setInviteVariant(variant);
    const code = variant === "demo" ? row.latest_demo_invite_code : row.latest_invite_code;
    setInviteData(code ? { code } : null);
  }, []);

  const createInvite = async () => {
    if (!inviteTarget?.influencer_id) return;
    setInviteCreating(true);
    try {
      const path =
        inviteVariant === "demo"
          ? `/admin/influencers/${inviteTarget.influencer_id}/demo-invite`
          : `/admin/influencers/${inviteTarget.influencer_id}/invite`;
      const { data } = await api.post(path, {});
      setInviteData(data.invitation || { code: data.code });
      toast.success(inviteVariant === "demo" ? "Demo link created" : "Training link created");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create invitation");
    } finally {
      setInviteCreating(false);
    }
  };

  const createStandaloneDemoInvite = async () => {
    setDemoInviteCreating(true);
    try {
      const { data } = await api.post("/admin/demo/invites", {
        label: demoLabel.trim(),
        email_hint: demoEmailHint.trim(),
      });
      const invitation = data?.invitation || data;
      setLatestDemoInvite(invitation);
      setDemoLabel("");
      setDemoEmailHint("");
      toast.success("Demo invitation created");
      await loadDemoInvites();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create demo invitation");
    } finally {
      setDemoInviteCreating(false);
    }
  };

  const demoCode = latestDemoInvite?.code || "";
  const demoInviteUrl = demoCode ? buildInviteUrl(demoCode) : "";

  const demoInviteColumns = useMemo(
    () => [
      columnHelper.accessor("code", {
        header: "Code",
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.label || row.email_hint || "—", {
        id: "label",
        header: "Label",
      }),
      columnHelper.accessor((row) => (row.created_at ? new Date(row.created_at).getTime() : 0), {
        id: "created_at",
        header: "Created",
        cell: (info) => fmtDate(info.row.original.created_at),
      }),
      columnHelper.accessor((row) => formatInviteClicked(row, fmtDate), {
        id: "clicked",
        header: "Link opened",
        enableSorting: false,
      }),
      columnHelper.accessor((row) => formatInviteConnectedAccount(row), {
        id: "connected_account",
        header: "Connected account",
        enableSorting: false,
      }),
      columnHelper.accessor((row) => formatInviteStatus(row), {
        id: "status",
        header: "Status",
        enableSorting: false,
      }),
    ],
    [],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => `${row.name || ""} ${row.notes || ""}`, {
        id: "creator",
        header: "Creator",
        cell: (info) => {
          const row = info.row.original;
          return (
            <>
              <p className="font-semibold">{row.name}</p>
              {row.notes ? <p className="mt-0.5 text-xs text-zinc-500">{row.notes}</p> : null}
            </>
          );
        },
      }),
      columnHelper.accessor((row) => `${row.platform || ""} ${row.handle || ""}`, {
        id: "platform",
        header: "Platform",
        cell: (info) => {
          const row = info.row.original;
          return (
            <span className="capitalize">
              {row.platform}
              {row.handle ? ` · ${row.handle}` : ""}
            </span>
          );
        },
      }),
      columnHelper.accessor((row) => row.linked_email || row.email || "—", {
        id: "hirly_account",
        header: "Hirly account",
      }),
      columnHelper.accessor(
        (row) => (row.linked_demo_account || row.demo_granted ? "Active" : "Not granted"),
        {
          id: "demo",
          header: "Demo",
          meta: {
            filterVariant: "select",
            filterOptions: [
              { value: "Active", label: "Active" },
              { value: "Not granted", label: "Not granted" },
            ],
          },
          cell: (info) =>
            info.getValue() === "Active" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                <Sparkles className="h-3 w-3" />
                Active
              </span>
            ) : (
              <span className="text-zinc-400">Not granted</span>
            ),
        },
      ),
      columnHelper.accessor((row) => (row.updated_at ? new Date(row.updated_at).getTime() : 0), {
        id: "updated_at",
        header: "Updated",
        cell: (info) => fmtDate(info.row.original.updated_at),
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="default" onClick={() => openInviteModal(row, "training")}>
                <Link2 className="h-4 w-4" />
                Training link
              </Button>
              <Button size="sm" variant="outline" onClick={() => openInviteModal(row, "demo")}>
                <MonitorPlay className="h-4 w-4" />
                Demo link
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={grantingId === row.influencer_id || row.linked_demo_account}
                onClick={() => grantDemo(row.influencer_id)}
              >
                {grantingId === row.influencer_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Grant demo"
                )}
              </Button>
            </div>
          );
        },
      }),
    ],
    [grantingId, openInviteModal, grantDemo],
  );

  return (
    <AdminShell
      title="Influencers"
      subtitle="Track creators, send training or demo WhatsApp links, and grant demo access manually."
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      }
    >
      {accessDenied ? (
        <AdminAccessDenied />
      ) : error && !rows.length ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-bold">Add influencer</h2>
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={createInfluencer}
            >
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
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
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
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add influencer
              </Button>
            </form>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <MonitorPlay className="h-5 w-5 text-violet-600" />
              <div>
                <h2 className="font-display text-lg font-bold">Demo account links</h2>
                <p className="text-sm text-zinc-500">
                  Standalone demo invites (no training access). Share via WhatsApp.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                value={demoLabel}
                onChange={(e) => setDemoLabel(e.target.value)}
                placeholder="Label (optional)"
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <input
                type="email"
                value={demoEmailHint}
                onChange={(e) => setDemoEmailHint(e.target.value)}
                placeholder="Email hint (optional)"
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
            </div>
            <Button
              className="mt-3"
              disabled={demoInviteCreating}
              onClick={createStandaloneDemoInvite}
            >
              {demoInviteCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MonitorPlay className="mr-2 h-4 w-4" />
              )}
              Generate demo link
            </Button>
            {demoCode ? (
              <div className="mt-4 space-y-2 rounded-lg bg-violet-50/80 p-4">
                <p className="font-mono text-xl font-bold tracking-[0.2em]">{demoCode}</p>
                <div className="flex items-start gap-2">
                  <p className="flex-1 break-all text-sm text-zinc-700">{demoInviteUrl}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText("Link", demoInviteUrl)}
                  >
                    <Link2 className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="mt-4">
              <AdminDataTable
                columns={demoInviteColumns}
                data={demoInvites}
                loading={demoInviteLoading}
                getRowId={(row) => row.invite_id || row.code}
                searchPlaceholder="Search demo links…"
                emptyMessage="No demo links yet."
                initialSorting={[{ id: "created_at", desc: true }]}
              />
            </div>
          </section>

          <AdminDataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowId={(row) => row.influencer_id}
            searchPlaceholder="Search by creator, platform, or account…"
            emptyMessage="No influencers tracked yet."
            initialSorting={[{ id: "updated_at", desc: true }]}
          />
        </div>
      )}

      <InviteModal
        open={Boolean(inviteTarget)}
        onClose={() => {
          setInviteTarget(null);
          setInviteData(null);
        }}
        influencer={inviteTarget}
        invite={inviteData}
        creating={inviteCreating}
        onCreate={createInvite}
        variant={inviteVariant}
      />
    </AdminShell>
  );
}
