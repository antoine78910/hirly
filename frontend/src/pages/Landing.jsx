// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
import { Button } from "../components/ui/button";
import { ArrowRight, Sparkles, Zap, FileCheck2, Inbox, Heart, X, Star, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import Logo from "../components/Logo";
import { BRAND } from "../lib/brand";

const startGoogleLogin = () => {
  const authUrl = process.env.REACT_APP_AUTH_URL;
  if (!authUrl) {
    console.error("REACT_APP_AUTH_URL is not configured.");
    return;
  }
  const redirectUrl = window.location.origin + "/swipe";
  window.location.href = `${authUrl}?redirect=${encodeURIComponent(redirectUrl)}`;
};

export default function Landing() {
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
            onClick={startGoogleLogin}
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
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <Button
              data-testid="hero-cta-btn"
              onClick={startGoogleLogin}
              size="lg"
              className="rounded-full gradient-linkedin hover:opacity-90 text-white font-semibold h-12 px-7 text-base pulse-ring"
            >
              {BRAND.CTA}
              <ArrowRight className="ml-1.5 w-4 h-4" />
            </Button>
            <p className="text-xs text-zinc-500 sm:ml-2 flex items-center gap-1">
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
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-zinc-100 text-zinc-700">$140k–$200k</span>
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
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <div className="gradient-linkedin text-white rounded-3xl p-10 sm:p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-grid pointer-events-none" />
          <h2 className="relative font-display font-black text-4xl sm:text-5xl tracking-tighter">
            Start swiping.
          </h2>
          <p className="relative mt-3 text-white/80">Your next job is one swipe away.</p>
          <Button
            data-testid="footer-cta-btn"
            onClick={startGoogleLogin}
            size="lg"
            className="relative mt-8 rounded-full bg-white text-linkedin hover:bg-zinc-100 font-semibold h-12 px-7 text-base"
          >
            {BRAND.CTA} <ArrowRight className="ml-1.5 w-4 h-4" />
          </Button>
        </div>
      </section>

      <footer className="border-t border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-zinc-400">
          <p>© {new Date().getFullYear()} {BRAND.NAME}</p>
          <p>Built with Claude Sonnet 4.5</p>
        </div>
      </footer>
    </div>
  );
}
