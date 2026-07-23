import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Users, UserPlus, Loader2, TrendingUp, GraduationCap, Mail, BookOpen } from "lucide-react";
import { api } from "../lib/api";
import TrainingShell, { useTrainingPageMode } from "../components/training/TrainingShell";
import { useTrainingLocale } from "../context/TrainingLocaleContext";
import { trainingPath } from "../lib/trainingRoutes";
import { Progress } from "../components/ui/progress";

const STAGE_KEYS = ["new", "contacted", "qualified", "enrolled", "won", "lost"];

const STAGE_COLORS = {
  new: "bg-zinc-100 text-zinc-700",
  contacted: "bg-blue-50 text-blue-700",
  qualified: "bg-violet-50 text-violet-700",
  enrolled: "bg-emerald-50 text-emerald-700",
  won: "bg-fuchsia-50 text-fuchsia-700",
  lost: "bg-rose-50 text-rose-700",
};

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold text-zinc-900">{value}</p>
    </div>
  );
}

export default function TrainingCreator() {
  useTrainingPageMode();
  const navigate = useNavigate();
  const { lang, t } = useTrainingLocale();
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
        toast.error(t("creator.accessRequired"));
        navigate(trainingPath(lang), { replace: true });
        return;
      }
      toast.error(e?.response?.data?.detail || t("creator.loadError"));
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadStudents, loadLeads, navigate, t, lang]);

  useEffect(() => {
    load();
  }, [load]);

  const addLead = async (e) => {
    e.preventDefault();
    if (!form.email.trim()) {
      toast.error(t("creator.emailRequired"));
      return;
    }
    setSavingLead(true);
    try {
      await api.post("/training/creator/leads", form);
      setForm({ name: "", email: "", notes: "" });
      await loadLeads();
      await loadOverview();
      toast.success(t("creator.leadAdded"));
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("creator.addLeadError"));
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
      toast.error(err?.response?.data?.detail || t("creator.updateLeadError"));
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#f7f7f8]">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
      </div>
    );
  }

  const stats = dashboard?.stats || {};
  const tabs = [
    { id: "overview", label: t("creator.overview") },
    { id: "students", label: t("creator.students") },
    { id: "leads", label: t("creator.leads") },
  ];

  return (
    <TrainingShell
      showSidebar={false}
      isCreator
      title={t("creator.title")}
      subtitle={t("creator.subtitle")}
      actions={
        <button
          type="button"
          onClick={() => navigate(trainingPath(lang))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          <BookOpen className="h-4 w-4" />
          {t("catalog")}
        </button>
      }
    >
      <div className="mb-6 flex gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm w-fit">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === item.id ? "bg-violet-600 text-white" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={GraduationCap}
              label={t("creator.courses")}
              value={stats.courses ?? 0}
            />
            <StatCard icon={Users} label={t("creator.students")} value={stats.students ?? 0} />
            <StatCard
              icon={TrendingUp}
              label={t("creator.avgProgress")}
              value={`${stats.avg_progress ?? 0}%`}
            />
            <StatCard icon={UserPlus} label={t("creator.leadsLabel")} value={stats.leads ?? 0} />
          </div>

          {dashboard?.stage_counts ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-zinc-900">{t("creator.pipeline")}</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(dashboard.stage_counts).map(([stage, count]) => (
                  <span
                    key={stage}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${STAGE_COLORS[stage] || STAGE_COLORS.new}`}
                  >
                    {t(`stages.${stage}`)}: {count}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-zinc-100 px-6 py-4">
              <h2 className="font-bold text-zinc-900">{t("creator.recentStudents")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-6 py-3">{t("creator.student")}</th>
                    <th className="px-6 py-3">{t("creator.course")}</th>
                    <th className="px-6 py-3">{t("progress")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {students.slice(0, 8).map((s) => (
                    <tr key={s.enrollment_id} className="hover:bg-zinc-50/80">
                      <td className="px-6 py-4">
                        <p className="font-semibold text-zinc-900">
                          {s.name || s.email || t("creator.studentFallback")}
                        </p>
                        <p className="text-xs text-zinc-500">{s.email}</p>
                      </td>
                      <td className="px-6 py-4 text-zinc-600">{s.course_title}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Progress
                            value={s.progress_percent}
                            className="h-2 w-28 bg-violet-100 [&>div]:bg-violet-600"
                          />
                          <span className="text-xs font-bold text-violet-600">
                            {s.progress_percent}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!students.length ? (
                <p className="px-6 py-10 text-center text-sm text-zinc-500">
                  {t("creator.noEnrollments")}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {tab === "students" && (
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-6 py-3">{t("creator.student")}</th>
                  <th className="px-6 py-3">{t("creator.course")}</th>
                  <th className="px-6 py-3">{t("progress")}</th>
                  <th className="px-6 py-3">{t("creator.updated")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {students.map((s) => (
                  <tr key={s.enrollment_id} className="hover:bg-zinc-50/80">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-zinc-900">
                        {s.name || t("creator.studentFallback")}
                      </p>
                      <p className="text-xs text-zinc-500">{s.email}</p>
                    </td>
                    <td className="px-6 py-4 text-zinc-600">{s.course_title}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Progress
                          value={s.progress_percent}
                          className="h-2 w-32 bg-violet-100 [&>div]:bg-violet-600"
                        />
                        <span className="text-xs font-bold text-violet-600">
                          {s.progress_percent}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-500">
                      {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!students.length ? (
              <p className="px-6 py-12 text-center text-sm text-zinc-500">
                {t("creator.noStudents")}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {tab === "leads" && (
        <div className="grid gap-8 xl:grid-cols-[380px_1fr]">
          <form
            onSubmit={addLead}
            className="h-fit rounded-2xl border border-violet-200 bg-violet-50/50 p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
              <Mail className="h-4 w-4 text-violet-600" />
              {t("creator.addLead")}
            </h2>
            <div className="mt-4 space-y-3">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("creator.namePlaceholder")}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={t("creator.emailPlaceholder")}
                type="email"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder={t("creator.notesPlaceholder")}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>
            <button
              type="submit"
              disabled={savingLead}
              className="mt-4 w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {savingLead ? t("creator.saving") : t("creator.saveLead")}
            </button>
          </form>

          <div className="space-y-3">
            {leads.map((lead) => (
              <div
                key={lead.lead_id}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-zinc-900">
                      {lead.name || t("creator.unnamedLead")}
                    </p>
                    <p className="text-sm text-zinc-500">{lead.email}</p>
                    {lead.notes ? <p className="mt-2 text-sm text-zinc-600">{lead.notes}</p> : null}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${STAGE_COLORS[lead.stage] || STAGE_COLORS.new}`}
                  >
                    {t(`stages.${lead.stage}`)}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(stages.length ? stages : STAGE_KEYS).map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      onClick={() => updateLeadStage(lead.lead_id, stage)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        lead.stage === stage
                          ? "bg-violet-600 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      }`}
                    >
                      {t(`stages.${stage}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!leads.length ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 bg-white py-12 text-center text-sm text-zinc-500">
                {t("creator.noLeads")}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </TrainingShell>
  );
}
