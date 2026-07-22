import { useEffect, useState } from "react";
import { Briefcase, GraduationCap, Layers, Sparkles, Target, Users } from "lucide-react";
import { api } from "../../lib/api";

function RomeSection({ title, items, Icon, iconClass }) {
  if (!items?.length) return null;
  return (
    <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3">
      <h3 className="mb-2 flex items-center gap-2 font-display text-base font-bold text-white">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
        {title}
        <span className="font-normal text-sprout-muted">({items.length})</span>
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm leading-relaxed text-sprout-muted"
          >
            <span className="mt-1.5 text-[8px] text-sprout-mint">●</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RomeGroupedSection({ title, groups, Icon, iconClass }) {
  if (!groups?.length) return null;
  return (
    <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3 space-y-3">
      <h3 className="flex items-center gap-2 font-display text-base font-bold text-white">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
        {title}
      </h3>
      {groups.map((group) => (
        <div key={group.title}>
          <h4 className="mb-1 text-sm font-semibold text-white">{group.title}</h4>
          <ul className="space-y-1.5">
            {(group.items || []).map((item) => (
              <li
                key={`${group.title}-${item}`}
                className="flex items-start gap-2 text-sm text-sprout-muted"
              >
                <span className="mt-1.5 text-[8px] text-sprout-mint">●</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default function JobRomeProfile({ job, t, enabled = true }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !job?.job_id || !job?.rome_code) {
      setProfile(null);
      setError("");
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(`/jobs/${job.job_id}/rome-profile`)
      .then((res) => {
        if (cancelled) return;
        setProfile(res.data?.available ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setError(t("swipe.romeProfileUnavailable"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, job?.job_id, job?.rome_code, t]);

  if (!job?.rome_code) return null;
  if (loading) {
    return <p className="text-sm text-sprout-muted">{t("swipe.romeProfileLoading")}</p>;
  }
  if (error) {
    return <p className="text-sm text-sprout-muted">{error}</p>;
  }
  if (!profile) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-white">
          {t("swipe.romeProfileTitle")}
        </h3>
        <span className="rounded-full bg-sprout-surface-2 px-2.5 py-1 text-xs font-medium text-sprout-muted">
          {profile.rome_code}
        </span>
      </div>
      {profile.label ? <p className="text-sm font-semibold text-white">{profile.label}</p> : null}
      {profile.definition ? (
        <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Briefcase className="h-4 w-4 text-sprout-mint" aria-hidden="true" />
            {t("swipe.romeDefinition")}
          </h4>
          <p className="text-sm leading-relaxed text-sprout-muted whitespace-pre-wrap">
            {profile.definition}
          </p>
        </section>
      ) : null}
      {profile.access ? (
        <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <GraduationCap className="h-4 w-4 text-sprout-mint" aria-hidden="true" />
            {t("swipe.romeAccess")}
          </h4>
          <p className="text-sm leading-relaxed text-sprout-muted whitespace-pre-wrap">
            {profile.access}
          </p>
        </section>
      ) : null}
      <RomeSection
        title={t("swipe.romeCoreSkills")}
        items={profile.core_skills}
        Icon={Target}
        iconClass="text-sprout-mint"
      />
      <RomeSection
        title={t("swipe.romeEmergingSkills")}
        items={profile.emerging_skills}
        Icon={Sparkles}
        iconClass="text-amber-500"
      />
      <RomeGroupedSection
        title={t("swipe.romeSkillGroups")}
        groups={profile.skill_groups}
        Icon={Layers}
        iconClass="text-sprout-mint"
      />
      <RomeGroupedSection
        title={t("swipe.romeKnowledge")}
        groups={profile.knowledge_groups}
        Icon={GraduationCap}
        iconClass="text-sprout-mint"
      />
      <RomeGroupedSection
        title={t("swipe.romeWorkContext")}
        groups={profile.context_groups}
        Icon={Users}
        iconClass="text-sprout-mint"
      />
      <RomeSection
        title={t("swipe.romeAlsoKnownAs")}
        items={profile.appellations}
        Icon={Briefcase}
        iconClass="text-sprout-muted"
      />
      <RomeSection
        title={t("swipe.romeSectors")}
        items={profile.sectors}
        Icon={Briefcase}
        iconClass="text-sprout-muted"
      />
    </div>
  );
}
