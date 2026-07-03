import { useParams, Navigate, Link } from "react-router-dom";
import { Check, X, ArrowRight } from "lucide-react";
import { startGoogleLogin } from "../../lib/auth";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import MarketingFaq from "../../components/marketing/MarketingFaq";
import { getCompareBySlug } from "../../lib/seo/compareData";

export default function Compare() {
  const { slug } = useParams();
  const page = getCompareBySlug(slug);

  if (!page) return <Navigate to="/" replace />;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": page.title,
    "description": page.metaDescription,
    "datePublished": "2026-07-03",
    "publisher": { "@type": "Organization", "name": "Hirly", "url": "https://tryhirly.com" },
    "mainEntityOfPage": { "@type": "WebPage", "@id": `https://tryhirly.com/compare/${page.slug}` },
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": page.faq.map((q) => ({
      "@type": "Question",
      "name": q.question,
      "acceptedAnswer": { "@type": "Answer", "text": q.answer },
    })),
  };

  const hirlyWins = ["Candidature automatique", "Génération CV adapté", "Lettre de motivation IA", "Soumission ATS directe", "Matching IA", "Suivi candidatures"];

  return (
    <MarketingLayout>
      <SEOHead
        title={`${page.metaTitle} | Hirly`}
        description={page.metaDescription}
        canonical={`/compare/${page.slug}`}
        jsonLd={[jsonLd, faqLd]}
      />

      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Comparatif</p>
          <h1 className="font-display font-black text-4xl sm:text-5xl tracking-tight mb-5">
            Hirly <span className="text-zinc-300">vs</span> {page.competitor}
          </h1>
          <p className="text-zinc-500 text-base sm:text-lg max-w-xl mx-auto">
            {page.metaDescription}
          </p>
        </div>

        {/* Taglines */}
        <div className="grid sm:grid-cols-2 gap-4 mb-14">
          <div className="rounded-2xl gradient-linkedin text-white p-6 text-center">
            <p className="text-sm font-semibold text-white/70 mb-1">Hirly</p>
            <p className="font-display font-bold text-lg leading-snug">{page.hirlyTagline}</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
            <p className="text-sm font-semibold text-zinc-400 mb-1">{page.competitor}</p>
            <p className="font-display font-bold text-lg leading-snug text-zinc-700">{page.competitorTagline}</p>
          </div>
        </div>

        {/* Feature table */}
        <div className="mb-14">
          <h2 className="font-display font-bold text-2xl tracking-tight mb-5">Comparaison des fonctionnalités</h2>
          <div className="rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="grid grid-cols-3 bg-zinc-50 border-b border-zinc-200 px-5 py-3">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Fonctionnalité</p>
              <p className="text-xs font-semibold text-linkedin uppercase tracking-widest text-center">Hirly</p>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest text-center">{page.competitor}</p>
            </div>
            {page.features.map((row, i) => {
              const isHirlyWin = hirlyWins.some(w => row.feature.includes(w.split(" ")[0]));
              return (
                <div
                  key={i}
                  className={`grid grid-cols-3 px-5 py-3.5 border-b border-zinc-100 last:border-0 items-center ${i % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}`}
                >
                  <p className="text-sm font-medium text-zinc-700">{row.feature}</p>
                  <div className="flex items-center justify-center gap-2">
                    {row.hirly === "Non" ? (
                      <span className="flex items-center gap-1 text-xs text-zinc-400"><X className="w-3.5 h-3.5" /> Non</span>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-center">{row.hirly}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {row.competitor === "Non" ? (
                      <span className="flex items-center gap-1 text-xs text-zinc-400"><X className="w-3.5 h-3.5" /> Non</span>
                    ) : (
                      <span className="text-xs text-zinc-600 text-center">{row.competitor}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sections */}
        {page.sections.map((s, i) => (
          <div key={i} className="mb-8">
            <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight mb-3">{s.h2}</h2>
            <p className="text-zinc-600 leading-relaxed text-base">{s.body}</p>
          </div>
        ))}

        {/* Verdict */}
        <div className="my-12 rounded-2xl bg-zinc-900 text-white px-7 py-8">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Notre verdict</p>
          <p className="font-display font-bold text-xl leading-snug">{page.verdict}</p>
        </div>

        {/* FAQ */}
        <div className="mb-14">
          <h2 className="font-display font-bold text-2xl tracking-tight mb-6">Questions fréquentes</h2>
          <MarketingFaq items={page.faq} />
        </div>

        {/* CTA */}
        <div className="rounded-3xl overflow-hidden border border-zinc-200 text-center">
          <div className="gradient-linkedin-soft px-7 py-10">
            <h2 className="font-display font-black text-2xl tracking-tight mb-2">
              Essayer Hirly gratuitement
            </h2>
            <p className="text-zinc-500 text-sm mb-6">
              Créez votre profil en 2 minutes et commencez à swiper vos prochaines offres.
            </p>
            <button
              onClick={() => startGoogleLogin("/swipe")}
              className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-6 py-2.5 text-sm hover:opacity-90 transition-opacity"
            >
              Commencer avec Hirly <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Other comparisons */}
        <div className="mt-12">
          <p className="text-sm font-semibold text-zinc-400 mb-3">Autres comparatifs</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/compare/hirly-vs-linkedin" className="text-sm font-medium text-zinc-600 hover:text-linkedin border border-zinc-200 rounded-full px-3 py-1.5 hover:border-linkedin transition-colors">Hirly vs LinkedIn</Link>
            <Link to="/compare/hirly-vs-indeed" className="text-sm font-medium text-zinc-600 hover:text-linkedin border border-zinc-200 rounded-full px-3 py-1.5 hover:border-linkedin transition-colors">Hirly vs Indeed</Link>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
