import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Button } from "../ui/button";
import {
  buildFriendReferralShareMessage,
  fetchFriendReferralStatus,
  shareFriendReferralCode,
} from "../../lib/friendReferral";
import {
  trackFriendReferralCodeCopied,
  trackFriendReferralCodeShared,
  trackFriendReferralUsesProgress,
} from "../../lib/friendReferralAnalytics";

const STATUS_POLL_MS = 8000;

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
        toast.success(lang === "fr" ? "Lien copié — partagez-le à vos amis" : "Link copied — share it with friends");
      }
      return;
    }

    toast.error(lang === "fr" ? "Impossible de partager le code" : "Could not share code");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[1.75rem] border-zinc-200 px-6 pb-8 pt-3 [&>button.absolute]:hidden"
        data-testid="friend-referral-dialog"
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-zinc-300" aria-hidden />

        <SheetHeader className="space-y-2 text-center">
          <SheetTitle className="font-display text-2xl font-bold tracking-tight text-zinc-900">
            {lang === "fr" ? "Partagez votre code" : "Share your invite code"}
          </SheetTitle>
          <SheetDescription className="text-sm leading-relaxed text-zinc-500">
            {lang === "fr"
              ? "Invitez 3 amis pour débloquer l\u2019accès gratuit."
              : "Invite 3 friends to unlock free access."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex items-center gap-3 rounded-full border border-violet-200 bg-violet-50 px-4 py-3.5">
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-1">
              <Loader2 className="h-5 w-5 animate-spin text-linkedin" />
            </div>
          ) : (
            <p
              className="min-w-0 flex-1 text-center font-display text-2xl font-black tracking-[0.18em] text-zinc-900"
              data-testid="friend-referral-code"
            >
              {code || "——"}
            </p>
          )}
          <button
            type="button"
            onClick={copyInviteMessage}
            disabled={!code}
            className={`inline-flex h-10 shrink-0 items-center justify-center rounded-full border transition-all duration-200 disabled:opacity-40 ${
              copied
                ? "gap-1.5 border-emerald-200 bg-emerald-50 px-3 text-emerald-700"
                : "w-10 border-violet-200 bg-white text-zinc-600 hover:bg-violet-100"
            }`}
            aria-label={copied ? (lang === "fr" ? "Copié" : "Copied") : (lang === "fr" ? "Copier le message" : "Copy invite message")}
            data-testid="friend-referral-copy"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" strokeWidth={2.5} />
                <span className="text-xs font-bold">{lang === "fr" ? "Copié !" : "Copied!"}</span>
              </>
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
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

        <p className="mt-5 text-center text-sm text-zinc-600" data-testid="friend-referral-progress">
          {lang === "fr" ? "Amis inscrits" : "Total friends joined"}
          {": "}
          <span className="font-bold text-zinc-900">{usesCount}</span>
          {goal ? ` / ${goal}` : ""}
        </p>
      </SheetContent>
    </Sheet>
  );
}
