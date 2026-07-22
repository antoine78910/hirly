import { useEffect, useState } from "react";
import { Copy, Share2, Coins } from "lucide-react";
import { toast } from "sonner";
import { useAppLocale } from "../../context/AppLocaleContext";
import { getFollowedSocials, markSocialFollowed } from "../../lib/referral";
import {
  enrollFriendReferral,
  fetchFriendReferralStatus,
  getLastSeenFriendReferralBatches,
  normalizeReferralCodeInput,
  redeemFriendReferralCode,
  setLastSeenFriendReferralBatches,
  shareFriendReferralCode,
  buildFriendReferralShareUrl,
} from "../../lib/friendReferral";

// No official social accounts yet -- keep the "follow us" task design/data
// ready to re-enable later, just don't render it for now.
const SHOW_SOCIAL_TASKS = false;

const SOCIAL_TASKS = [
  { id: "instagram", label: "Instagram", credits: 2, url: "https://instagram.com" },
  { id: "reddit", label: "Reddit", credits: 2, url: "https://reddit.com" },
  { id: "tiktok", label: "TikTok", credits: 2, url: "https://tiktok.com" },
  { id: "youtube", label: "YouTube", credits: 2, url: "https://youtube.com" },
  { id: "linkedin", label: "LinkedIn", credits: 2, url: "https://linkedin.com" },
];

function SocialIcon({ id }) {
  const cls = "h-5 w-5";
  if (id === "instagram") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2.2c2.7 0 3 .01 4.04.06 1.01.05 1.56.22 1.93.37.48.19.83.41 1.2.78.36.37.59.72.78 1.2.15.37.32.92.37 1.93.05 1.04.06 1.34.06 4.04s-.01 3-.06 4.04c-.05 1.01-.22 1.56-.37 1.93-.19.48-.41.83-.78 1.2-.37.36-.72.59-1.2.78-.37.15-.92.32-1.93.37-1.04.05-1.34.06-4.04.06s-3-.01-4.04-.06c-1.01-.05-1.56-.22-1.93-.37-.48-.19-.83-.41-1.2-.78-.36-.37-.59-.72-.78-1.2-.15-.37-.32-.92-.37-1.93-.05-1.04-.06-1.34-.06-4.04s.01-3 .06-4.04c.05-1.01.22-1.56.37-1.93.19-.48.41-.83.78-1.2.37-.36.72-.59 1.2-.78.37-.15.92-.32 1.93-.37 1.04-.05 1.34-.06 4.04-.06zm0-2.2C9.2 0 8.88.01 7.82.06 6.77.11 6.05.3 5.43.55c-.64.25-1.18.58-1.72 1.12-.54.54-.87 1.08-1.12 1.72-.25.62-.44 1.34-.49 2.39C2.01 8.88 2 9.2 2 12s.01 3.12.06 4.18c.05 1.05.24 1.77.49 2.39.25.64.58 1.18 1.12 1.72.54.54 1.08.87 1.72 1.12.62.25 1.34.44 2.39.49 1.06.05 1.38.06 4.18.06s3.12-.01 4.18-.06c1.05-.05 1.77-.24 2.39-.49.64-.25 1.18-.58 1.72-1.12.54-.54.87-1.08 1.12-1.72.25-.62.44-1.34.49-2.39.05-1.06.06-1.38.06-4.18s-.01-3.12-.06-4.18c-.05-1.05-.24-1.77-.49-2.39-.25-.64-.58-1.18-1.12-1.72-.54-.54-1.08-.87-1.72-1.12-.62-.25-1.34-.44-2.39-.49C15.12.01 14.8 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zm0 10.16a3.99 3.99 0 1 1 0-7.98 3.99 3.99 0 0 1 0 7.98zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
      </svg>
    );
  }
  if (id === "reddit") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
      </svg>
    );
  }
  if (id === "tiktok") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
      </svg>
    );
  }
  if (id === "youtube") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

/** Referral code, progress, redeem form, and social-follow tasks -- shared
 * between the standalone /referral page and the Profile "Referral" tab. */
export default function ReferralPanel() {
  const { t } = useAppLocale();
  const [followed, setFollowed] = useState(() => getFollowedSocials());
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [justCompletedCredits, setJustCompletedCredits] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        let data = await fetchFriendReferralStatus();
        if (!data?.code) {
          data = await enrollFriendReferral();
        }
        setStatus(data);
        const batchesGranted = data?.reward_batches_granted || 0;
        const lastSeen = getLastSeenFriendReferralBatches();
        if (batchesGranted > lastSeen) {
          const perBatchCredits =
            data?.credits_earned_total && batchesGranted
              ? data.credits_earned_total / batchesGranted
              : 40;
          setJustCompletedCredits((batchesGranted - lastSeen) * perBatchCredits);
          setLastSeenFriendReferralBatches(batchesGranted);
        }
      } catch {
        toast.error(t("referralPanel.loadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const code = status?.code || "";
  const usesCount = status?.uses_count || 0;
  const goal = status?.goal || 3;
  const progressInCycle = status?.progress_in_cycle ?? usesCount % goal;
  const remainingToNextReward = goal - progressInCycle;
  const creditsEarnedTotal = status?.credits_earned_total || 0;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(buildFriendReferralShareUrl(code));
      toast.success(t("referralPanel.linkCopied"));
    } catch {
      toast.error(t("referralPanel.copyError"));
    }
  };

  const shareCode = async () => {
    const result = await shareFriendReferralCode(code);
    if (result.ok && result.method === "clipboard") {
      toast.success(t("referralPanel.linkCopied"));
    } else if (!result.ok && result.reason !== "aborted") {
      toast.error(t("referralPanel.shareError"));
    }
  };

  const submitRedeemCode = async (e) => {
    e.preventDefault();
    const value = normalizeReferralCodeInput(redeemCode);
    if (!value) return;
    setRedeeming(true);
    try {
      const result = await redeemFriendReferralCode(value);
      if (result?.ok) {
        toast.success(t("referralPanel.redeemSuccess"));
        setRedeemCode("");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("referralPanel.redeemError"));
    } finally {
      setRedeeming(false);
    }
  };

  const handleFollow = (task) => {
    if (followed.includes(task.id)) return;
    window.open(task.url, "_blank", "noopener,noreferrer");
    const next = markSocialFollowed(task.id);
    setFollowed(next);
    toast.success(`+${task.credits} credits earned — thanks for following!`);
  };

  return (
    <div className="text-zinc-900">
      <div className="flex flex-col items-center text-center md:items-start md:text-left">
        <div className="relative mb-4">
          <div className="flex -space-x-3">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 shadow-md">
              <Coins className="h-8 w-8 text-amber-900/80" strokeWidth={1.5} />
            </div>
            <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-300 to-linkedin shadow-md">
              <Coins className="h-8 w-8 text-white/90" strokeWidth={1.5} />
            </div>
          </div>
          <span className="absolute -right-1 -top-1 text-lg">✨</span>
        </div>

        <h1 className="font-display text-2xl font-bold">{t("referralPanel.heading")}</h1>
        <p className="mt-2 max-w-xs text-sm text-zinc-600">{t("referralPanel.body", { goal })}</p>
      </div>

      {loading ? (
        <div className="mt-8 h-16 animate-pulse rounded-2xl bg-zinc-100" />
      ) : (
        <>
          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-4">
            <span
              className="flex-1 font-mono text-2xl font-bold tracking-[0.2em] text-zinc-900"
              data-testid="referral-code"
            >
              {code || "——"}
            </span>
            <button
              type="button"
              onClick={shareCode}
              className="grid h-10 w-10 place-items-center rounded-xl text-zinc-500 hover:bg-white hover:text-linkedin"
              aria-label={t("referralPanel.shareCodeLabel")}
              data-testid="referral-share"
            >
              <Share2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={copyCode}
              className="grid h-10 w-10 place-items-center rounded-xl text-zinc-500 hover:bg-white hover:text-linkedin"
              aria-label={t("referralPanel.copyCodeLabel")}
              data-testid="referral-copy"
            >
              <Copy className="h-5 w-5" />
            </button>
          </div>

          {justCompletedCredits > 0 && (
            <div
              className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center"
              data-testid="referral-completed-banner"
            >
              <p className="font-display text-lg font-bold text-emerald-700">
                🎉 {t("referralPanel.completedTitle", { goal })}
              </p>
              <p className="mt-1 text-sm text-emerald-700">
                {t("referralPanel.completedBody", { credits: justCompletedCredits })}
              </p>
            </div>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span data-testid="referral-progress-label">
                {t("referralPanel.progressLabel", { count: progressInCycle, goal })}
              </span>
              <span>{t("referralPanel.remainingToNext", { count: remainingToNextReward })}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-zinc-100">
              <div
                className="h-2 rounded-full gradient-linkedin transition-all"
                style={{ width: `${(progressInCycle / goal) * 100}%` }}
              />
            </div>
            {usesCount > 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                {t("referralPanel.totalReferred", {
                  count: usesCount,
                  plural: usesCount === 1 ? "" : "s",
                })}
                {creditsEarnedTotal > 0
                  ? t("referralPanel.creditsEarned", { count: creditsEarnedTotal })
                  : ""}
              </p>
            )}
          </div>

          <form onSubmit={submitRedeemCode} className="mt-6 flex items-center gap-2">
            <input
              type="tel"
              value={redeemCode}
              onChange={(e) => setRedeemCode(normalizeReferralCodeInput(e.target.value))}
              onPaste={(e) => {
                e.preventDefault();
                setRedeemCode(normalizeReferralCodeInput(e.clipboardData.getData("text")));
              }}
              placeholder={t("referralPanel.redeemPlaceholder")}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              className="h-11 flex-1 rounded-xl border border-zinc-200 px-4 text-sm font-mono tracking-widest focus:border-linkedin focus:outline-none"
              data-testid="referral-redeem-input"
            />
            <button
              type="submit"
              disabled={!redeemCode.trim() || redeeming}
              className="h-11 rounded-xl gradient-linkedin px-4 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="referral-redeem-submit"
            >
              {redeeming ? t("referralPanel.redeemApplying") : t("referralPanel.redeemApply")}
            </button>
          </form>
        </>
      )}

      {SHOW_SOCIAL_TASKS && (
        <>
          <p className="mt-10 text-center text-sm text-zinc-500">Follow us on socials</p>

          <ul className="mt-4 divide-y divide-dashed divide-zinc-200">
            {SOCIAL_TASKS.map((task) => {
              const done = followed.includes(task.id);
              return (
                <li key={task.id} className="flex items-center gap-3 py-4">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                    <SocialIcon id={task.id} />
                  </div>
                  <span className="flex-1 text-sm font-medium text-zinc-800">
                    +{task.credits} Credits
                  </span>
                  <button
                    type="button"
                    disabled={done}
                    onClick={() => handleFollow(task)}
                    className={`min-w-[88px] rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                      done
                        ? "bg-zinc-100 text-zinc-400"
                        : "gradient-linkedin text-white hover:opacity-90"
                    }`}
                    data-testid={`referral-follow-${task.id}`}
                  >
                    {done ? "Followed" : "Follow"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
