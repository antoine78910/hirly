import ResumeCurrentPreview from "./ResumeCurrentPreview";
import { exampleResumeProfile } from "../../lib/exampleResume";
import { useAppLocale } from "../../context/AppLocaleContext";

/** Kyle Hoffmann sample resume shown when the user has not uploaded a CV yet. */
export default function ResumeExamplePreview({ active = true, compact = false }) {
  const { t } = useAppLocale();
  const profile = exampleResumeProfile();

  return (
    <div className="space-y-2" data-testid="resume-example-preview">
      <p className="text-xs leading-relaxed text-zinc-500">{t("resumeSheet.exampleResumeHint")}</p>
      <ResumeCurrentPreview
        profile={profile}
        active={active}
        compact={compact}
        isExample
      />
    </div>
  );
}
