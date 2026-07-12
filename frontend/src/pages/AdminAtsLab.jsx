import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, FlaskConical, Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import CVPreview from "../components/CVPreview";
import CoverLetterPreview from "../components/CoverLetterPreview";
import { downloadCoverLetter, downloadTailoredCV } from "../lib/pdf";
import { normalizeCoverLetter } from "../lib/applicationDocuments";

function Section({ title, children, className = "" }) {
  return (
    <section className={`rounded-lg border border-zinc-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="font-display text-lg font-bold text-zinc-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ScorePill({ label, value }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-display text-2xl font-black text-zinc-900">{value ?? "—"}</p>
    </div>
  );
}

function KeywordTable({ rows = [] }) {
  if (!rows.length) {
    return <p className="text-sm text-zinc-500">No keyword analysis returned.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <th className="px-3 py-2">Keyword</th>
            <th className="px-3 py-2">Importance</th>
            <th className="px-3 py-2">In CV</th>
            <th className="px-3 py-2">Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.keyword}-${index}`} className="border-b border-zinc-100 align-top">
              <td className="px-3 py-2 font-medium text-zinc-900">{row.keyword}</td>
              <td className="px-3 py-2 text-zinc-600">{row.importance || "—"}</td>
              <td className="px-3 py-2 text-zinc-600">{row.present_in_cv || "—"}</td>
              <td className="px-3 py-2 text-zinc-600">{row.integration_recommendation || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAtsLab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [applications, setApplications] = useState([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");
  const [persist, setPersist] = useState(false);
  const [result, setResult] = useState(null);

  const selectedId = searchParams.get("application_id") || "";

  const loadApplications = useCallback(async () => {
    setLoadingApps(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data } = await api.get("/admin/applications");
      setApplications(data.applications || []);
    } catch (err) {
      setApplications([]);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(adminApiErrorMessage(err, "Could not load applications"));
      }
    } finally {
      setLoadingApps(false);
    }
  }, []);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const selectedApp = useMemo(
    () => applications.find((item) => item.application_id === selectedId) || null,
    [applications, selectedId],
  );

  const runGeneration = async () => {
    if (!selectedId) {
      toast.error("Select an application first");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const { data } = await api.post(
        "/admin/ats-lab/generate",
        { application_id: selectedId, persist },
        { timeout: 180000 },
      );
      setResult(data);
      toast.success(`Generated in ${Math.round((data.elapsed_ms || 0) / 1000)}s${data.persisted ? " and saved" : ""}`);
    } catch (err) {
      toast.error(adminApiErrorMessage(err, "Generation failed"));
      setError(adminApiErrorMessage(err, "Generation failed"));
    } finally {
      setGenerating(false);
    }
  };

  const generation = result?.generation || {};
  const atsAnalysis = generation.ats_analysis || {};
  const tailoredResume = result?.tailored_resume || {};
  const coverLetter = normalizeCoverLetter(result?.tailored_cover_letter || {});
  const contact = tailoredResume.contact || result?.profile_snapshot?.contact || {};
  const job = result?.job || {
    title: selectedApp?.job_title,
    company: selectedApp?.company,
    location: selectedApp?.location,
    ats_provider: selectedApp?.ats_provider,
  };
  const templateStyle = result?.profile_snapshot?.template_style || "modern";

  const handleDownloadCv = () => {
    downloadTailoredCV({
      contact,
      resume: tailoredResume,
      job,
      template: templateStyle,
    });
  };

  const handleDownloadLetter = () => {
    downloadCoverLetter({
      contact,
      letter: coverLetter,
      job,
      template: coverLetter.template || "french_formal",
    });
  };

  return (
    <AdminShell
      title="ATS Lab"
      subtitle="Experiment with GPT tailoring, keyword analysis, and PDF export (admin only)."
      actions={(
        <Button type="button" variant="outline" onClick={loadApplications} disabled={loadingApps}>
          {loadingApps ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied /> : null}
      {error && !accessDenied ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <Section title="Select application">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="ats-lab-application">Application</Label>
            <select
              id="ats-lab-application"
              value={selectedId}
              onChange={(event) => {
                const next = event.target.value;
                if (next) setSearchParams({ application_id: next });
                else setSearchParams({});
                setResult(null);
              }}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
              data-testid="ats-lab-application-select"
            >
              <option value="">Choose an application…</option>
              {applications.map((app) => (
                <option key={app.application_id} value={app.application_id}>
                  {app.company || "Company"} — {app.job_title || "Role"} — {app.user_email || app.user_id}
                </option>
              ))}
            </select>
            {selectedApp ? (
              <p className="text-sm text-zinc-500">
                ATS: <span className="font-semibold text-zinc-800">{selectedApp.ats_provider || "unknown"}</span>
                {" · "}
                <Link to={`/admin/applications/${selectedApp.application_id}`} className="text-linkedin hover:underline">
                  Open application detail
                </Link>
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <Switch checked={persist} onCheckedChange={setPersist} />
              Save result to application
            </label>
            <Button type="button" onClick={runGeneration} disabled={!selectedId || generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              {generating ? "Generating…" : "Run ATS generation"}
            </Button>
          </div>
        </div>
      </Section>

      {result ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ScorePill label="ATS score (before)" value={generation.ats_score_before ?? atsAnalysis.score_current} />
            <ScorePill label="ATS score (after)" value={generation.ats_score_after ?? atsAnalysis.score_after_optimization} />
            <ScorePill label="Match score" value={generation.match_score} />
            <ScorePill label="ATS provider" value={generation.ats_provider || job.ats_provider} />
          </div>

          <Section title="Critical keywords">
            <KeywordTable rows={atsAnalysis.critical_keywords || generation.keywords_gap || []} />
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="CV changes">
              <div className="space-y-4">
                {Array.isArray(tailoredResume.content_plan) && tailoredResume.content_plan.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Content plan</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
                      {tailoredResume.content_plan.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {Array.isArray(atsAnalysis.final_checklist) && atsAnalysis.final_checklist.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Final checklist</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
                      {atsAnalysis.final_checklist.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {Array.isArray(atsAnalysis.optimized_experience_notes) && atsAnalysis.optimized_experience_notes.length ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Experience edits</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
                      {atsAnalysis.optimized_experience_notes.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Original CV excerpt</p>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700 whitespace-pre-wrap">
                    {(result.profile_snapshot?.cv_text || "").slice(0, 2500) || "No CV text on profile."}
                  </pre>
                </div>
              </div>
            </Section>

            <Section title="Tailored CV preview">
              <CVPreview contact={contact} resume={tailoredResume} theme="light" />
              <div className="mt-4">
                <Button type="button" variant="outline" onClick={handleDownloadCv}>
                  <Download className="h-4 w-4" />
                  Download CV PDF — {job.company || "Company"}
                </Button>
              </div>
            </Section>
          </div>

          <Section title={`Cover letter — ${job.company || "Company"}`}>
            <CoverLetterPreview contact={contact} letter={coverLetter} job={job} theme="light" />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleDownloadLetter}>
                <Download className="h-4 w-4" />
                Download letter PDF — {job.company || "Company"}
              </Button>
              {result.persisted ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <Save className="h-3.5 w-3.5" />
                  Saved to application
                </span>
              ) : null}
            </div>
          </Section>

          <Section title="Raw GPT payload">
            <pre className="max-h-[420px] overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100 whitespace-pre-wrap">
              {JSON.stringify(generation, null, 2)}
            </pre>
          </Section>
        </div>
      ) : (
        <p className="mt-6 text-sm text-zinc-500">
          Select an application and run ATS generation to inspect keyword optimization, CV edits, and the tailored cover letter.
        </p>
      )}
    </AdminShell>
  );
}
