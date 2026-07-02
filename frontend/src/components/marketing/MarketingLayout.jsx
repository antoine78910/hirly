import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { startGoogleLogin } from "../../lib/auth";

export default function MarketingLayout({ children }) {
  const navigate = useNavigate();

  const onCTA = () => startGoogleLogin("/swipe");

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display font-black tracking-tight text-lg">
            <Logo size={28} />
            <span>{BRAND.NAME}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600">
            <Link to="/how-it-works" className="hover:text-zinc-900 transition-colors">How it works</Link>
            <Link to="/blog" className="hover:text-zinc-900 transition-colors">Blog</Link>
            <Link to="/compare/hirly-vs-linkedin" className="hover:text-zinc-900 transition-colors">Compare</Link>
          </nav>
          <button
            onClick={onCTA}
            className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-5 py-2 text-sm hover:opacity-90 transition-opacity"
          >
            {BRAND.CTA_PRIMARY}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Page content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t border-zinc-100 mt-24">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="grid sm:grid-cols-3 gap-8 mb-8">
            <div>
              <Link to="/" className="flex items-center gap-2 font-display font-black tracking-tight mb-3">
                <Logo size={24} />
                <span>{BRAND.NAME}</span>
              </Link>
              <p className="text-sm text-zinc-500 leading-relaxed">{BRAND.TAGLINE}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Product</p>
              <ul className="space-y-2 text-sm text-zinc-600">
                <li><Link to="/how-it-works" className="hover:text-zinc-900">How it works</Link></li>
                <li><Link to="/use-cases" className="hover:text-zinc-900">Use cases</Link></li>
                <li><Link to="/for/juniors" className="hover:text-zinc-900">For juniors</Link></li>
                <li><Link to="/for/reconversion" className="hover:text-zinc-900">For career changers</Link></li>
                <li><Link to="/for/developpeurs" className="hover:text-zinc-900">For developers</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Compare</p>
              <ul className="space-y-2 text-sm text-zinc-600">
                <li><Link to="/compare/hirly-vs-linkedin" className="hover:text-zinc-900">Hirly vs LinkedIn</Link></li>
                <li><Link to="/compare/hirly-vs-indeed" className="hover:text-zinc-900">Hirly vs Indeed</Link></li>
                <li><Link to="/blog" className="hover:text-zinc-900">Blog</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-zinc-100 pt-6 text-xs text-zinc-400">
            © {new Date().getFullYear()} {BRAND.NAME} · All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
