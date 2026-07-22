import { Link } from "react-router-dom";
import { GraduationCap, Mail } from "lucide-react";
import { getPendingInviteCode } from "../../lib/creatorInvite";

export default function TrainingAccessDenied() {
  const pendingCode = getPendingInviteCode();
  const invitePath = pendingCode ? `/invite/${pendingCode}` : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-4 py-12 text-center">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
        <GraduationCap className="h-7 w-7 text-violet-600" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
        Training is invite-only
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-500">
        You need a personal invitation link from the Hirly team to access the creator training. Open
        the link you received by email, or ask your contact for a new one.
      </p>

      {invitePath ? (
        <Link
          to={invitePath}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <Mail className="h-4 w-4" />
          Activate my invitation
        </Link>
      ) : (
        <p className="mt-6 text-xs text-zinc-400">
          If you already have a 6-digit code, complete onboarding or open your invitation link
          directly.
        </p>
      )}

      <Link to="/" className="mt-8 text-sm font-semibold text-violet-600 hover:underline">
        Back to Hirly
      </Link>
    </div>
  );
}
