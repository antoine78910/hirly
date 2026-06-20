import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import { Button } from "../components/ui/button";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import {
  buildInviteUrl,
  clearPendingInviteCode,
  redeemCreatorInvite,
  storePendingInviteCode,
} from "../lib/creatorInvite";
import { startGoogleLogin } from "../lib/auth";

export default function InviteLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, setUser } = useAuth();
  const [checking, setChecking] = useState(true);
  const [inviteMeta, setInviteMeta] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const autoRedeemStarted = useRef(false);

  useEffect(() => {
    const normalized = String(code || "").trim();
    if (!/^\d{6}$/.test(normalized)) {
      setChecking(false);
      return;
    }
    storePendingInviteCode(normalized);
    (async () => {
      try {
        const { data } = await api.get(`/invites/${normalized}/validate`);
        setInviteMeta(data);
      } catch {
        setInviteMeta({ valid: false, reason: "not_found" });
      } finally {
        setChecking(false);
      }
    })();
  }, [code]);

  useEffect(() => {
    if (authLoading || checking || !user || redeeming || autoRedeemStarted.current) return;
    const normalized = String(code || "").trim();
    if (!/^\d{6}$/.test(normalized)) return;
    autoRedeemStarted.current = true;
    (async () => {
      setRedeeming(true);
      try {
        const data = await redeemCreatorInvite(api, normalized);
        if (data?.demo_account && user) {
          setDemoAccountFromUser({ ...user, demo_account: true });
          setUser({ ...user, demo_account: true });
        }
        toast.success("Creator access activated");
        navigate("/training", { replace: true });
      } catch (err) {
        autoRedeemStarted.current = false;
        if (err?.response?.status !== 409) {
          toast.error(err?.response?.data?.detail || "Could not activate invitation");
        }
      } finally {
        setRedeeming(false);
      }
    })();
  }, [authLoading, checking, user, code, navigate, redeeming, setUser]);

  const normalized = String(code || "").trim();
  const invalid = !/^\d{6}$/.test(normalized);

  const startSignup = async () => {
    storePendingInviteCode(normalized);
    sessionStorage.setItem("swiipr_onboarding_return", "/training");
    if (user) {
      navigate("/training", { replace: true });
      return;
    }
    await startGoogleLogin("/training");
  };

  if (checking || redeeming || (user && !invalid)) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-zinc-600">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Setting up your creator access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-violet-50 to-white px-4 py-10">
      <div className="mx-auto max-w-lg">
        <Logo className="mx-auto h-8 w-auto" />
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-violet-700">
            <Sparkles className="h-5 w-5" />
            <p className="text-sm font-semibold uppercase tracking-wide">Creator invitation</p>
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold text-zinc-900">
            {invalid || inviteMeta?.valid === false
              ? "Invalid invitation link"
              : `Welcome${inviteMeta?.influencer_name ? `, ${inviteMeta.influencer_name}` : ""}`}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            {invalid || inviteMeta?.valid === false ? (
              "This link is missing or expired. Ask the Hirly team for a fresh invitation."
            ) : (
              "Create your Hirly account to access the Talking Heads training course and a demo account for screen recordings."
            )}
          </p>
          {!invalid && inviteMeta?.valid !== false ? (
            <div className="mt-5 rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
              <p>
                Your access code:
                {" "}
                <span className="font-mono text-base font-bold tracking-widest">{normalized}</span>
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                You can also enter this 6-digit code at the end of mobile onboarding.
              </p>
            </div>
          ) : null}
          <div className="mt-6 space-y-3">
            {!invalid && inviteMeta?.valid !== false ? (
              <Button className="w-full" onClick={startSignup}>
                Create account & start training
              </Button>
            ) : null}
            <Button variant="outline" className="w-full" asChild>
              <Link to="/">Back to Hirly</Link>
            </Button>
          </div>
          {!invalid ? (
            <p className="mt-4 text-center text-xs text-zinc-400 break-all">
              {buildInviteUrl(normalized)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="mx-auto mt-4 block text-xs text-zinc-400 hover:text-zinc-600"
          onClick={() => clearPendingInviteCode()}
        >
          Clear saved invitation
        </button>
      </div>
    </div>
  );
}
