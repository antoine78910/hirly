import { useState } from "react";
import { Phone, Plus } from "lucide-react";
import { toast } from "sonner";
import { BrandHeader } from "../components/app/AppScreenHeader";
import { BRAND } from "../lib/brand";

const TABS = [
  { key: "feedback", label: "Feedback" },
  { key: "release", label: "Release Notes" },
];

const WELCOME_MESSAGE = {
  text: `What do you love/hate about ${BRAND.NAME}? This goes directly to the founders 💬`,
  time: "5:52 PM",
};

const RELEASE_NOTES = [
  { version: "v0.4", date: "Jun 2026", note: "New swipe feed filters and inbox categories." },
  { version: "v0.3", date: "May 2026", note: "One-tap apply packages with tailored CV + cover letter." },
  { version: "v0.2", date: "Apr 2026", note: "Profile completion wizard and mock interviews." },
];

export default function Feedback() {
  const [tab, setTab] = useState("feedback");
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    toast.success("Thanks! Your message was sent to the team.");
    setDraft("");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-white pb-28 text-zinc-900">
      <BrandHeader
        rightAction={
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full text-linkedin hover:bg-violet-50"
            aria-label="Call support"
            onClick={() => toast.message("Support line coming soon")}
          >
            <Phone className="h-5 w-5" strokeWidth={2} />
          </button>
        }
      />

      <div className="flex border-b border-zinc-200">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`relative flex-1 py-3 text-sm font-semibold transition-colors ${
                active ? "text-linkedin" : "text-zinc-400"
              }`}
              data-testid={`feedback-tab-${t.key}`}
            >
              {t.label}
              {active ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-linkedin" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-5">
        {tab === "feedback" ? (
          <div>
            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 text-[15px] leading-relaxed text-zinc-800">
              {WELCOME_MESSAGE.text}
            </div>
            <p className="mt-1.5 text-xs text-zinc-400">{WELCOME_MESSAGE.time}</p>
          </div>
        ) : (
          <ul className="space-y-4">
            {RELEASE_NOTES.map((item) => (
              <li key={item.version} className="border-b border-zinc-100 pb-4">
                <p className="text-sm font-bold text-zinc-900">
                  {item.version}
                  <span className="ml-2 font-medium text-zinc-400">{item.date}</span>
                </p>
                <p className="mt-1 text-sm text-zinc-600">{item.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {tab === "feedback" ? (
        <div className="border-t border-zinc-100 px-4 py-3">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500"
              aria-label="Attach file"
              onClick={() => toast.message("Attachments coming soon")}
            >
              <Plus className="h-5 w-5" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message"
              className="h-11 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              data-testid="feedback-message-input"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
