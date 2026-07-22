import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Button } from "../ui/button";
import {
  buildFriendReferralShareMessage,
  fetchFriendReferralStatus,
  shareFriendReferralCode,
  FRIEND_REFERRAL_GOAL,
  FRIEND_REFERRAL_REWARD_CREDITS,
} from "../../lib/friendReferral";
import {
  trackFriendReferralCodeCopied,
  trackFriendReferralCodeShared,
  trackFriendReferralUsesProgress,
} from "../../lib/friendReferralAnalytics";

const STATUS_POLL_MS = 8000;
const REFERRAL_CODE_LENGTH = 6;

function referralCodeChars(code) {
  const normalized = (code || "").trim().toUpperCase();
  if (!normalized) {
    return Array.from({ length: REFERRAL_CODE_LENGTH }, () => "—");
  }
  return normalized.padEnd(REFERRAL_CODE_LENGTH, " ").slice(0, REFERRAL_CODE_LENGTH).split("");
}

function SpacedReferralCode({ code, testId }) {
  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-2" data-testid={testId}>
      {referralCodeChars(code).map((char, index) => (
        <span
          key={`${char}-${index}`}
          className="min-w-[1ch] text-center font-display text-xl font-black tabular-nums tracking-wide text-swiipr-gradient sm:text-2xl"
        >
          {char.trim() || "—"}
        </span>
      ))}
    </div>
  );
}

function AnimatedCopyButton({ copied, onClick, disabled, testId, copiedLabel, defaultLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors duration-300 disabled:opacity-40 ${
        copied
          ? "border-emerald-200 bg-emerald-50"
          : "border-violet-200 bg-white text-zinc-600 hover:bg-violet-100"
      }`}
      aria-label={copied ? copiedLabel : defaultLabel}
      data-testid={testId}
    >
      <Copy
        className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
          copied ? "scale-50 opacity-0 rotate-90" : "scale-100 opacity-100 rotate-0"
        }`}
        aria-hidden
      />
      <Check
        className={`absolute h-4 w-4 text-emerald-600 transition-all duration-300 ease-out ${
          copied ? "scale-100 opacity-100 rotate-0" : "scale-50 opacity-0 -rotate-90"
        }`}
        strokeWidth={2.5}
        aria-hidden
      />
    </button>
  );
}

export default function FriendReferralCodeDialog({
  open,
  onOpenChange,
  code,
  usesCount = 0,
  goal = 3,
  lang = "fr",
  loading = false,
  onUsesCountChange,
}) {
  const [copied, setCopied] = useState(false);
  const lastUsesRef = useRef(usesCount);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  useEffect(() => {
    lastUsesRef.current = usesCount;
  }, [usesCount]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    const refreshStatus = async () => {
      try {
        const status = await fetchFriendReferralStatus();
        if (cancelled || !status) return;
        const nextUses = Number(status.uses_count) || 0;
        if (typeof onUsesCountChange === "function") {
          onUsesCountChange(nextUses);
        }
        trackFriendReferralUsesProgress(lastUsesRef.current, nextUses, {
          code: status.code || code,
        });
        lastUsesRef.current = nextUses;
      } catch {
        /* keep current count */
      }
    };

    void refreshStatus();
    const timer = window.setInterval(refreshStatus, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, onUsesCountChange, code]);

  const copyInviteMessage = async () => {
    if (!code) return;
    const message = buildFriendReferralShareMessage(code, lang);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      trackFriendReferralCodeCopied({ code, uses_count: String(usesCount) });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(lang === "fr" ? "Impossible de copier le message" : "Could not copy message");
    }
  };

  const shareCode = async () => {
    if (!code) return;
    const result = await shareFriendReferralCode(code, lang);

    if (result.reason === "aborted") return;

    if (result.ok) {
      trackFriendReferralCodeShared({
        code,
        method: result.method,
        uses_count: String(usesCount),
        share_url: result.url,
      });
      if (result.method === "clipboard") {
        toast.success(
          lang === "fr"
            ? "Lien copié — partagez-le à vos amis"
            : "Link copied — share it with friends",
        );
      }
      return;
    }

    toast.error(lang === "fr" ? "Impossible de partager le code" : "Could not share code");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[1.75rem] border-zinc-200 px-6 pb-8 pt-3 md:left-1/2 md:right-auto md:bottom-6 md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-[1.75rem] [&>button.absolute]:hidden"
        data-testid="friend-referral-dialog"
      >
        <div className="mx-auto w-full max-w-sm">
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-zinc-300" aria-hidden />

          <SheetHeader className="space-y-2 text-center">
            <SheetTitle className="font-display text-2xl font-bold tracking-tight text-zinc-900">
              {lang === "fr" ? "Partagez votre code" : "Share your invite code"}
            </SheetTitle>
            <SheetDescription className="text-sm leading-relaxed text-zinc-500">
              {lang === "fr"
                ? `Invitez ${FRIEND_REFERRAL_GOAL} amis pour débloquer l\u2019accès gratuit et recevoir ${FRIEND_REFERRAL_REWARD_CREDITS} candidatures.`
                : `Invite ${FRIEND_REFERRAL_GOAL} friends to unlock free access and get ${FRIEND_REFERRAL_REWARD_CREDITS} applications.`}
            </SheetDescription>
          </SheetHeader>

          <div className="relative mt-5 flex w-full items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-14 py-3.5">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-linkedin" />
            ) : (
              <SpacedReferralCode code={code} testId="friend-referral-code" />
            )}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3">
              <AnimatedCopyButton
                copied={copied}
                onClick={copyInviteMessage}
                disabled={!code}
                testId="friend-referral-copy"
                copiedLabel={lang === "fr" ? "Copié" : "Copied"}
                defaultLabel={lang === "fr" ? "Copier le message" : "Copy invite message"}
              />
            </div>
          </div>

          <Button
            type="button"
            variant="brand"
            className="mt-4 h-12 w-full rounded-full text-base font-bold"
            onClick={shareCode}
            disabled={!code}
            data-testid="friend-referral-share"
          >
            <Share2 className="mr-2 h-4 w-4" />
            {lang === "fr" ? "Partager" : "Share"}
          </Button>

          <p
            className="mt-5 text-center text-sm text-zinc-600"
            data-testid="friend-referral-progress"
          >
            {lang === "fr" ? "Amis inscrits" : "Total friends joined"}
            {": "}
            <span className="font-bold text-zinc-900">{usesCount}</span>
            {goal ? ` / ${goal}` : ""}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
