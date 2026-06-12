import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmtDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function JsonBlock({ value }) {
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">{JSON.stringify(value || {}, null, 2)}</pre>;
}

export default function AdminUserDetail() {
  const { userId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

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
        setError(err?.response?.data?.detail || "Could not load user");
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
  const summary = useMemo(() => {
    return [
      profile.summary,
      profile.cv_text ? `CV text: ${profile.cv_text.length} characters` : "",
      user.profile_completion !== undefined ? `Profile completion: ${user.profile_completion}%` : "",
    ].filter(Boolean).join("\n");
  }, [profile, user.profile_completion]);

  if (loading) {
    return <div className="grid min-h-dvh place-items-center bg-zinc-50"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>;
  }

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
            <Section title="Profile Summary">
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">{summary || "No profile summary available."}</pre>
            </Section>

            <Section title="Applications">
              <div className="space-y-2">
                {applications.length ? applications.map((app) => (
                  <Link key={app.application_id} to={`/admin/applications/${app.application_id}`} className="block rounded-md bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{app.company || "Unknown company"} · {app.title || "Unknown role"}</span>
                      <span className="capitalize text-zinc-500">{String(app.submission_status || "unknown").replaceAll("_", " ")}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{fmtDate(app.updated_at || app.created_at)}</p>
                  </Link>
                )) : <p className="text-sm text-zinc-500">No applications found.</p>}
              </div>
            </Section>
          </div>

          <aside className="space-y-5">
            <Section title="Contact">
              <JsonBlock value={data.contact} />
            </Section>
            <Section title="Preferences">
              <JsonBlock value={data.preferences} />
            </Section>
            <Section title="Application Defaults">
              <JsonBlock value={data.application_defaults} />
            </Section>
            <Section title="Internal Notes">
              <p className="text-sm text-zinc-500">User-level internal notes are not enabled yet.</p>
            </Section>
          </aside>
        </div>
      )}
    </AdminShell>
  );
}
