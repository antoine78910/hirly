import { useMemo, useState } from "react";
import { Phone, Plus } from "lucide-react";
import { toast } from "sonner";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import { BRAND } from "../lib/brand";
import { useAppLocale } from "../context/AppLocaleContext";

const RELEASE_NOTES = [
  { version: "v0.4", date: "Jun 2026", note: "New swipe feed filters and inbox categories." },
  { version: "v0.3", date: "May 2026", note: "One-tap apply packages with tailored CV + cover letter." },
  { version: "v0.2", date: "Apr 2026", note: "Profile completion wizard and mock interviews." },
];

export default function Feedback() {
  const { t } = useAppLocale();
  const [tab, setTab] = useState("feedback");
  const [draft, setDraft] = useState("");

  const tabs = useMemo(
    () => [
      { key: "feedback", label: t("feedback.title") },
      { key: "release", label: t("feedback.releaseNotes") },
    ],
    [t],
  );

  const welcomeMessage = t("feedback.welcomeMessage", { brand: BRAND.NAME });

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    toast.success(t("feedback.thanks"));
    setDraft("");
  };

  return (
    <AppPage className="bg-white text-zinc-900 md:py-8">
      <BrandHeader
        rightAction={
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full text-linkedin hover:bg-violet-50 sm:h-10 sm:w-10"
            aria-label={t("feedback.callSupport")}
            onClick={() => toast.message(t("feedback.supportSoon"))}
          >
            <Phone className="h-5 w-5" strokeWidth={2} />
          </button>
        }
      />

      <div className="flex shrink-0 border-b border-zinc-200 md:hidden">
        {tabs.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`relative flex-1 py-3 text-sm font-semibold transition-colors ${
                active ? "text-linkedin" : "text-zinc-400"
              }`}
              data-testid={`feedback-tab-${item.key}`}
            >
              {item.label}
              {active ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-linkedin" />
              ) : null}
            </button>
          );
        })}
      </div>

      <AppPageScroll className={`${APP_CONTENT_WIDTH} pt-5`}>
        <DesktopPageHeader title={t("feedback.title")} subtitle={t("feedback.subtitle")} />
        {tab === "feedback" ? (
          <div>
            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 text-[15px] leading-relaxed text-zinc-800">
              {welcomeMessage}
            </div>
            <div className="mt-6 flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("feedback.messagePlaceholder")}
                rows={3}
                className="flex-1 resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[15px] outline-none focus:border-violet-300"
                data-testid="feedback-input"
              />
              <button
                type="button"
                onClick={send}
                disabled={!draft.trim()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full gradient-linkedin text-white disabled:opacity-40"
                data-testid="feedback-send-btn"
                aria-label={t("emails.send")}
              >
                <Plus className="h-5 w-5 rotate-45" />
              </button>
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {RELEASE_NOTES.map((note) => (
              <li key={note.version} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-sm font-semibold text-zinc-900">
                  {note.version} · {note.date}
                </p>
                <p className="mt-1 text-sm text-zinc-600">{note.note}</p>
              </li>
            ))}
          </ul>
        )}
      </AppPageScroll>
    </AppPage>
  );
}
