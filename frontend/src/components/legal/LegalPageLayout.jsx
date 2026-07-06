import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Logo from "../Logo";
import SEOHead from "../seo/SEOHead";
import { BRAND, supportMailto } from "../../lib/brand";
import { isAppHost } from "../../lib/appDomains";
import { PRIVACY_PATH, TERMS_PATH } from "../../lib/legalPaths";

export default function LegalPageLayout({
  title,
  description,
  canonical,
  lastUpdated,
  children,
}) {
  const navigate = useNavigate();
  const onApp = isAppHost();

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <SEOHead
        title={`${title} | ${BRAND.NAME}`}
        description={description}
        canonical={canonical}
      />

      <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <button
            type="button"
            onClick={() => (onApp ? navigate(-1) : navigate("/"))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Link to={onApp ? "/swipe" : "/"} className="flex items-center gap-2 font-display text-lg font-black tracking-tight">
            <Logo size={26} />
            <span>{BRAND.NAME}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10 pb-16">
        <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {lastUpdated}</p>
        <div className="mt-8 max-w-none space-y-6 text-[15px] leading-relaxed text-zinc-700 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-zinc-900 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-zinc-900 [&_a]:text-[#0A66C2] [&_a]:underline-offset-2 hover:[&_a]:underline [&_li]:mt-1 [&_p]:text-zinc-700 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
      </main>

      <footer className="border-t border-zinc-100">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {BRAND.NAME}</p>
          <div className="flex flex-wrap gap-4">
            <Link to={TERMS_PATH} className="hover:text-zinc-900">
              Terms of Use
            </Link>
            <Link to={PRIVACY_PATH} className="hover:text-zinc-900">
              Privacy Policy
            </Link>
            <a href={supportMailto()} className="hover:text-zinc-900">
              {BRAND.SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
