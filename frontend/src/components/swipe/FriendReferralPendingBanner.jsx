import { useState } from "react";
import { Check, Copy, Users } from "lucide-react";
import { toast } from "sonner";
import { buildFriendReferralShareMessage } from "../../lib/friendReferral";

export default function FriendReferralPendingBanner({
  code,
  usesCount = 0,
  goal = 3,
  lang = "fr",
  onViewCode,
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!code) return;
    const message = buildFriendReferralShareMessage(code, lang);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(lang === "fr" ? "Impossible de copier le message" : "Could not copy message");
    }
  };

  return (
    <div
      className="mx-auto mb-2 w-full max-w-md rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-left sm:px-4"
      data-testid="friend-referral-pending-banner"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-linkedin">
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">
            {lang === "fr" ? "Invitez 3 amis pour débloquer l\u2019accès" : "Invite 3 friends to unlock access"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">
            {lang === "fr"
              ? `${usesCount}/${goal} amis inscrits — partagez votre code pour gagner 1 mois gratuit et 40 candidatures.`
              : `${usesCount}/${goal} friends signed up — share your code to unlock 1 free month and 40 applications.`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-black tracking-widest text-zinc-900">{code || "——"}</span>
            <button
              type="button"
              onClick={copyCode}
              className={`relative grid h-8 w-8 place-items-center rounded-full border transition-colors duration-300 ${
                copied
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-violet-200 bg-white text-zinc-700 hover:bg-violet-100"
              }`}
              aria-label={copied ? (lang === "fr" ? "Copié" : "Copied") : (lang === "fr" ? "Copier" : "Copy")}
              data-testid="friend-referral-banner-copy"
            >
              <Copy
                className={`absolute h-3.5 w-3.5 transition-all duration-300 ease-out ${
                  copied ? "scale-50 opacity-0 rotate-90" : "scale-100 opacity-100 rotate-0"
                }`}
                aria-hidden
              />
              <Check
                className={`absolute h-3.5 w-3.5 text-emerald-600 transition-all duration-300 ease-out ${
                  copied ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 -rotate-90"
                }`}
                strokeWidth={2.5}
                aria-hidden
              />
            </button>
            {onViewCode ? (
              <button
                type="button"
                onClick={onViewCode}
                className="inline-flex h-8 items-center rounded-full px-2 text-xs font-semibold text-linkedin hover:underline"
                data-testid="friend-referral-banner-details"
              >
                {lang === "fr" ? "Voir les détails" : "View details"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
