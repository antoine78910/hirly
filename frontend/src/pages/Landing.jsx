// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { Button } from "../components/ui/button";
import { ArrowRight, Sparkles, Zap, FileCheck2, Inbox, Heart, X, Star, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import Logo from "../components/Logo";
import { BRAND } from "../lib/brand";
import { startGoogleLogin } from "../lib/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { trackEvent } from "../lib/analytics";

export default function Landing() {
  const navigate = useNavigate();
  const { user, hasProfile, hasPreferences, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const postLoginPath = searchParams.get("redirect") || "/swipe";

  useEffect(() => {
    trackEvent("landing_view");
  }, []);

  const onSignIn = () => {
    trackEvent("cta_login_clicked", { location: "header" });
    startGoogleLogin(postLoginPath);
  };

  const onStartSwiping = () => {
    if (loading) return;
    trackEvent("cta_start_swiping_clicked", { authenticated: Boolean(user) });
    if (user) {
      navigate(hasProfile && hasPreferences ? "/swipe" : "/onboarding");
      return;
    }
    trackEvent("cta_signup_clicked", { location: "landing_start_swiping" });
    navigate("/signup");
  };

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2 font-display font-black tracking-tight text-lg" data-testid="brand">
            <Logo size={28} />
            <span>{BRAND.NAME}</span>
          </a>
          <Button
            data-testid="header-signin-btn"
            onClick={onSignIn}
            className="rounded-full bg-linkedin hover:bg-linkedin-dark text-white font-semibold px-5"
          >
            Sign in
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden gradient-linkedin-soft">
        <div className="absolute inset-0 bg-grid mask-radial pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20 lg:pt-28 lg:pb-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-linkedin/20 bg-white shadow-sm text-xs font-semibold text-linkedin mb-7"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI-tailored applications. 1 second each.
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="font-display font-black text-5xl sm:text-6xl lg:text-7xl tracking-tighter leading-[0.95]"
          >
            Swipe jobs.<br />
            <span className="italic text-swiipr-gradient">Get hired.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-6 text-lg sm:text-xl text-zinc-600 max-w-2xl mx-auto leading-relaxed"
          >
            Swipe right. Our AI tailors your CV and cover letter for every role.
            Apply in <span className="text-linkedin font-semibold">1 second</span> instead of 20 minutes.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-10 flex flex-col items-center justify-center gap-3"
          >
            <Button
              data-testid="hero-cta-btn"
              onClick={onStartSwiping}
              disabled={loading}
              size="lg"
              className="rounded-full gradient-linkedin hover:opacity-90 text-white font-semibold h-12 px-7 text-base pulse-ring"
            >
              {BRAND.CTA_PRIMARY}
              <ArrowRight className="ml-1.5 w-4 h-4" />
            </Button>
            <p className="flex items-center gap-1 text-xs text-zinc-500">
              <ShieldCheck className="w-3.5 h-3.5" /> Free · No credit card
            </p>
          </motion.div>

          {/* Demo card mockup */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="mt-20 relative max-w-sm mx-auto"
          >
            <div className="absolute -inset-x-8 -bottom-6 h-32 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none z-10" />
            <div className="absolute -top-6 -left-6 right-6 h-full rounded-3xl border border-zinc-200 bg-white rotate-[-4deg] opacity-50" />
            <div className="absolute -top-3 -right-3 left-3 h-full rounded-3xl border border-zinc-200 bg-white rotate-[3deg] opacity-70" />
            <div className="relative bg-white border border-zinc-200 rounded-3xl p-6 shadow-[0_24px_80px_-20px_rgba(124,58,237,0.25)] text-left">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold text-linkedin">Linear</p>
                  <h3 className="font-display font-bold text-xl">Senior Frontend Engineer</h3>
                </div>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-linkedin-light text-linkedin text-xs font-semibold">
                  <Sparkles className="w-3 h-3" /> 94% match
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-zinc-100 text-zinc-700">Remote</span>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-zinc-100 text-zinc-700">€140k–€200k</span>
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-zinc-100 text-zinc-700">TypeScript</span>
              </div>
              <ul className="text-sm text-zinc-600 space-y-1.5">
                <li>• 5 years TypeScript experience — perfect overlap</li>
                <li>• You shipped perf wins on a complex SaaS dashboard</li>
                <li>• Remote-first matches your preference</li>
              </ul>
              <div className="mt-6 flex items-center justify-between">
                <div className="w-12 h-12 rounded-full grid place-items-center border border-zinc-200">
                  <X className="w-5 h-5 text-zinc-400" />
                </div>
                <div className="w-14 h-14 rounded-full grid place-items-center gradient-linkedin text-white">
                  <Heart className="w-6 h-6" fill="white" />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Social proof */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-14 flex flex-col items-center gap-2"
          >
            <div className="flex items-center gap-1.5 text-amber-400">
              {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-amber-400" />)}
              <span className="ml-2 text-sm font-semibold text-zinc-700">4.9 · early access</span>
            </div>
            <p className="text-xs text-zinc-500">Trusted by job seekers from Google, Stripe, Vercel and more</p>
          </motion.div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-y border-zinc-100">
        <div className="max-w-5xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-6">
          <div className="bg-white border border-zinc-200 rounded-2xl p-8">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">The old way</p>
            <h3 className="font-display font-bold text-3xl mb-4">20 min / application</h3>
            <ul className="text-zinc-600 space-y-2 text-sm">
              <li>— Copy-paste the same CV everywhere</li>
              <li>— Write a generic cover letter</li>
              <li>— Fill out endless form fields</li>
              <li>— Lose track of who you applied to</li>
            </ul>
          </div>
          <div className="gradient-linkedin text-white rounded-2xl p-8">
            <p className="text-xs font-semibold text-white/70 uppercase tracking-widest mb-3">{BRAND.NAME}</p>
            <h3 className="font-display font-bold text-3xl mb-4">1 sec / application</h3>
            <ul className="text-white/90 space-y-2 text-sm">
              <li>— Upload CV once</li>
              <li>— Swipe right on jobs you like</li>
              <li>— AI tailors CV + cover letter for each</li>
              <li>— Track every application in one place</li>
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <h2 className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-center mb-16">
          Three taps to your next job.
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { icon: FileCheck2, title: "Upload your CV", body: "We extract your skills, experience, and target roles in seconds." },
            { icon: Zap, title: "Swipe through jobs", body: "Every card shows a match score and why this job fits you." },
            { icon: Inbox, title: "Track everything", body: "From applied → interview → offer. Your applications, one place." },
          ].map((s, i) => (
            <div key={i} className="border-t border-zinc-200 pt-6">
              <div className="w-10 h-10 rounded-xl gradient-linkedin text-white grid place-items-center mb-4">
                <s.icon className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-xl mb-1.5">{s.title}</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-20 sm:pt-28 sm:pb-28">
        <div className="overflow-hidden rounded-[48px] shadow-[0_24px_80px_-32px_rgba(124,58,237,0.28)]">
          <div className="gradient-linkedin relative px-8 py-12 text-center text-white sm:px-16 sm:py-16">
            <div className="pointer-events-none absolute inset-0 opacity-10 bg-grid" aria-hidden />
            <h2 className="relative font-display text-4xl font-black tracking-tighter sm:text-5xl">
              Start swiping.
            </h2>
            <p className="relative mt-3 text-white/80">Your next job is one swipe away.</p>
            <Button
              data-testid="footer-cta-btn"
              onClick={onStartSwiping}
              disabled={loading}
              size="lg"
              className="relative mt-8 h-12 rounded-full bg-white px-7 text-base font-semibold text-linkedin hover:bg-zinc-100"
            >
              {BRAND.CTA_SECONDARY} <ArrowRight className="ml-1.5 w-4 h-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Mobile app — coming soon */}
      <section className="mx-auto max-w-6xl px-6 pb-24" data-testid="coming-soon-app">
        <div className="relative overflow-hidden rounded-[48px] border border-white/80 bg-white/55 shadow-[0_16px_48px_-20px_rgba(124,58,237,0.22)] backdrop-blur-2xl">
          <div className="relative px-8 py-10 sm:px-14 sm:py-14 lg:px-16 lg:py-16">
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-50/50 via-white/35 to-blue-50/45"
              aria-hidden
            />
            <div className="relative flex flex-col items-center gap-12 md:flex-row md:items-center md:gap-16 lg:gap-24">
              <div
                className="relative shrink-0 rounded-[47px] border border-white/35 bg-white/20 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)] backdrop-blur-sm"
                data-framer-name="QR"
              >
                <div
                  className="relative z-10 m-4 aspect-square w-44 rounded-[23px] bg-white p-4 sm:m-5 sm:w-48 sm:p-5 lg:w-52"
                  data-framer-name="QR Code Image"
                >
                  <img
                    decoding="async"
                    loading="lazy"
                    src="https://api.qrserver.com/v1/create-qr-code/?size=1024x1024&margin=4&ecc=M&data=https://hirly.com"
                    alt=""
                    className="block h-full w-full object-contain object-center blur-[3px] select-none"
                    draggable={false}
                  />
                </div>
                <div
                  className="pointer-events-none absolute inset-4 z-0 rounded-[26px] opacity-100 blur-[22px] sm:inset-5"
                  data-framer-name="Blur"
                  style={{
                    background:
                      "linear-gradient(180deg, #A78BFA 0%, #7C3AED 31%, #6366F1 64.25%, #3B82F6 100%)",
                  }}
                  aria-hidden
                />
              </div>

              <div className="flex max-w-xl flex-col items-center text-center md:items-start md:text-left">
                <h2 className="font-display text-2xl font-black uppercase tracking-tight text-zinc-900 sm:text-3xl lg:text-[2.5rem] lg:leading-tight">
                  The application is coming soon
                </h2>
                <p className="mt-4 text-base leading-relaxed text-zinc-500 sm:text-lg">
                  {BRAND.NAME} will soon be available on mobile. Stay informed to be among the first to access it.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                  <button
                    type="button"
                    className="group inline-flex items-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-linkedin/35 hover:shadow-md"
                    aria-label="Google Play — available soon"
                  >
                    <svg className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110" viewBox="0 0 21 24" aria-hidden>
                      <path fill="#4285F4" d="M3 20.5V3.5C3 2.91 3.34 2.39 3.84 2.15L13.69 12 3.84 21.85c-.5-.24-.84-.76-.84-1.35z" />
                      <path fill="#34A853" d="M16.81 15.12 6.05 21.34l8.64-8.64z" />
                      <path fill="#FBBC05" d="M20.16 10.81c.18.63.18 1.31 0 1.94l-2.35 2.35-3.89-3.89v-2.3z" />
                      <path fill="#EA4335" d="M6.05 2.66l10.76 6.22-3.03 3.03z" />
                    </svg>
                    <div className="text-left leading-tight">
                      <p className="text-sm font-semibold tracking-tight text-zinc-700 transition-colors group-hover:text-linkedin">
                        Google Play
                      </p>
                      <p className="text-[10px] font-medium text-zinc-400 transition-colors group-hover:text-linkedin/70">
                        Available soon
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="group inline-flex items-center gap-2.5 rounded-lg bg-black px-5 py-2.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-900 hover:shadow-md"
                    aria-label="App Store — available soon"
                  >
                    <svg className="h-5 w-5 shrink-0 text-white transition-transform duration-200 group-hover:scale-110" viewBox="0 0 20 22" fill="currentColor" aria-hidden>
                      <path d="M15.71 19.17c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C1.25 16.67-.06 12.12 1.7 9.06c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M10 3c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                    </svg>
                    <div className="text-left leading-tight">
                      <p className="text-sm font-semibold tracking-tight text-white">App Store</p>
                      <p className="text-[10px] font-medium text-white/55 transition-colors group-hover:text-white/80">
                        Available soon
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-zinc-400">
          <p>© {new Date().getFullYear()} {BRAND.NAME}</p>
        </div>
      </footer>
    </div>
  );
}
