import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Users, UserPlus, Loader2, TrendingUp, GraduationCap, Mail,
} from "lucide-react";
import { api } from "../lib/api";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import { Progress } from "../components/ui/progress";

const STAGE_LABELS = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  enrolled: "Enrolled",
  won: "Won",
  lost: "Lost",
};

const STAGE_COLORS = {
  new: "bg-zinc-500/20 text-zinc-300",
  contacted: "bg-blue-500/20 text-blue-300",
  qualified: "bg-violet-500/20 text-violet-300",
  enrolled: "bg-emerald-500/20 text-emerald-300",
  won: "bg-fuchsia-500/20 text-fuchsia-300",
  lost: "bg-rose-500/20 text-rose-300",
};

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-2xl border border-sprout-border bg-sprout-surface p-4">
      <div className="flex items-center gap-2 text-sprout-muted">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-sprout-muted">{hint}</p> : null}
    </div>
  );
}

export default function TrainingCreator() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [students, setStudents] = useState([]);
  const [leads, setLeads] = useState([]);
  const [stages, setStages] = useState([]);
  const [savingLead, setSavingLead] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", notes: "" });

  const loadOverview = useCallback(async () => {
    const { data } = await api.get("/training/creator/dashboard");
    setDashboard(data);
  }, []);

  const loadStudents = useCallback(async () => {
    const { data } = await api.get("/training/creator/students");
    setStudents(data.students || []);
  }, []);

  const loadLeads = useCallback(async () => {
    const { data } = await api.get("/training/creator/leads");
    setLeads(data.leads || []);
    setStages(data.stages || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadStudents(), loadLeads()]);
    } catch (e) {
      if (e?.response?.status === 403) {
        toast.error("Creator access required");
        navigate("/training", { replace: true });
        return;
      }
      toast.error(e?.response?.data?.detail || "Could not load studio");
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadStudents, loadLeads, navigate]);

  useEffect(() => { load(); }, [load]);

  const addLead = async (e) => {
    e.preventDefault();
    if (!form.email.trim()) {
      toast.error("Email is required");
      return;
    }
    setSavingLead(true);
    try {
      await api.post("/training/creator/leads", form);
      setForm({ name: "", email: "", notes: "" });
      await loadLeads();
      await loadOverview();
      toast.success("Lead added");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add lead");
    } finally {
      setSavingLead(false);
    }
  };

  const updateLeadStage = async (leadId, stage) => {
    try {
      await api.patch(`/training/creator/leads/${leadId}`, { stage });
      await loadLeads();
      await loadOverview();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update lead");
    }
  };

  if (loading) {
    return (
      <AppPage className="sprout grid place-items-center bg-sprout-bg">
        <Loader2 className="h-5 w-5 animate-spin text-sprout-muted" />
      </AppPage>
    );
  }

  const stats = dashboard?.stats || {};

  return (
    <AppPage className="sprout bg-sprout-bg text-white">
      <header className="mx-auto w-full max-w-md shrink-0 px-5 pt-6">
        <button
          type="button"
          onClick={() => navigate("/training")}
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full hover:bg-sprout-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-3xl font-bold tracking-tight">Creator Studio</h1>
        <p className="mt-1 text-sm text-sprout-muted">CRM for your students and leads.</p>

        <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-sprout-surface p-1 no-scrollbar">
          {[
            { id: "overview", label: "Overview" },
            { id: "students", label: "Students" },
            { id: "leads", label: "Leads" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === item.id ? "bg-violet-600 text-white" : "text-sprout-muted hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <AppPageScroll className="mx-auto max-w-md px-5">
        {tab === "overview" && (
          <div className="mt-5 space-y-4 pb-6">
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={GraduationCap} label="Courses" value={stats.courses ?? 0} />
              <StatCard icon={Users} label="Students" value={stats.students ?? 0} />
              <StatCard
                icon={TrendingUp}
                label="Avg progress"
                value={`${stats.avg_progress ?? 0}%`}
              />
              <StatCard icon={UserPlus} label="Leads" value={stats.leads ?? 0} />
            </div>

            {dashboard?.stage_counts ? (
              <section className="rounded-2xl border border-sprout-border bg-sprout-surface p-4">
                <h2 className="text-sm font-semibold">Pipeline</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(dashboard.stage_counts).map(([stage, count]) => (
                    <span
                      key={stage}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${STAGE_COLORS[stage] || STAGE_COLORS.new}`}
                    >
                      {STAGE_LABELS[stage] || stage}: {count}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-sprout-muted">Recent students</h2>
              <div className="mt-3 space-y-2">
                {(students || []).slice(0, 5).map((s) => (
                  <div key={s.enrollment_id} className="rounded-xl border border-sprout-border bg-sprout-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.name || s.email || "Student"}</p>
                        <p className="truncate text-xs text-sprout-muted">{s.course_title}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-violet-300">{s.progress_percent}%</span>
                    </div>
                    <Progress
                      value={s.progress_percent}
                      className="mt-2 h-1 bg-violet-500/15 [&>div]:bg-violet-500"
                    />
                  </div>
                ))}
                {!students.length ? (
                  <p className="text-sm text-sprout-muted">No enrollments yet.</p>
                ) : null}
              </div>
            </section>
          </div>
        )}

        {tab === "students" && (
          <div className="mt-5 space-y-3 pb-6">
            {students.map((s) => (
              <div key={s.enrollment_id} className="rounded-xl border border-sprout-border bg-sprout-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{s.name || "Student"}</p>
                    <p className="text-sm text-sprout-muted">{s.email}</p>
                    <p className="mt-1 text-xs text-violet-300">{s.course_title}</p>
                  </div>
                  <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-200">
                    {s.progress_percent}%
                  </span>
                </div>
                <Progress
                  value={s.progress_percent}
                  className="mt-3 h-1.5 bg-violet-500/15 [&>div]:bg-gradient-to-r [&>div]:from-violet-500 [&>div]:to-fuchsia-500"
                />
              </div>
            ))}
            {!students.length ? (
              <p className="text-center text-sm text-sprout-muted py-8">No students enrolled yet.</p>
            ) : null}
          </div>
        )}

        {tab === "leads" && (
          <div className="mt-5 pb-6">
            <form onSubmit={addLead} className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="h-4 w-4 text-violet-300" />
                Add lead
              </h2>
              <div className="mt-3 space-y-2">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Name"
                  className="w-full rounded-xl border border-sprout-border bg-sprout-bg px-3 py-2.5 text-sm outline-none focus:border-violet-500"
                />
                <input
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Email"
                  type="email"
                  className="w-full rounded-xl border border-sprout-border bg-sprout-bg px-3 py-2.5 text-sm outline-none focus:border-violet-500"
                />
                <input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes (optional)"
                  className="w-full rounded-xl border border-sprout-border bg-sprout-bg px-3 py-2.5 text-sm outline-none focus:border-violet-500"
                />
              </div>
              <button
                type="submit"
                disabled={savingLead}
                className="mt-3 w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {savingLead ? "Saving…" : "Save lead"}
              </button>
            </form>

            <div className="mt-5 space-y-3">
              {leads.map((lead) => (
                <div key={lead.lead_id} className="rounded-xl border border-sprout-border bg-sprout-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{lead.name || "Unnamed lead"}</p>
                      <p className="text-sm text-sprout-muted">{lead.email}</p>
                      {lead.notes ? <p className="mt-1 text-xs text-sprout-muted">{lead.notes}</p> : null}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STAGE_COLORS[lead.stage] || STAGE_COLORS.new}`}>
                      {STAGE_LABELS[lead.stage] || lead.stage}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(stages.length ? stages : Object.keys(STAGE_LABELS)).map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => updateLeadStage(lead.lead_id, stage)}
                        className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
                          lead.stage === stage
                            ? "bg-violet-600 text-white"
                            : "bg-zinc-800 text-sprout-muted hover:text-white"
                        }`}
                      >
                        {STAGE_LABELS[stage] || stage}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!leads.length ? (
                <p className="text-center text-sm text-sprout-muted py-6">No leads yet.</p>
              ) : null}
            </div>
          </div>
        )}
      </AppPageScroll>
    </AppPage>
  );
}
