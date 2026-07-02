import { useParams, Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { startGoogleLogin } from "../../lib/auth";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import MarketingFaq from "../../components/marketing/MarketingFaq";
import { getProfileBySlug } from "../../lib/seo/profileData";

export default function ForProfile() {
  const { slug } = useParams();
  const page = getProfileBySlug(slug);

  if (!page) return <Navigate to="/" replace />;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": page.title,
    "description": page.metaDescription,
    "url": `https://hirly.app/for/${page.slug}`,
    "publisher": { "@type": "Organization", "name": "Hirly", "url": "https://hirly.app" },
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

  return (
    <MarketingLayout>
      <SEOHead
        title={`${page.metaTitle} | Hirly`}
        description={page.metaDescription}
        canonical={`/for/${page.slug}`}
        jsonLd={[jsonLd, faqLd]}
      />

      {/* Hero */}
      <section className="gradient-linkedin-soft border-b border-zinc-100">
        <div className="max-w-5xl mx-auto px-6 py-20 lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.05] mb-5">
              {page.headline}
            </h1>
            <p className="text-zinc-600 text-lg sm:text-xl leading-relaxed max-w-xl mb-8">
              {page.subheadline}
            </p>
            <button
              onClick={() => startGoogleLogin("/swipe")}
              className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-6 py-3 text-base hover:opacity-90 transition-opacity pulse-ring"
            >
              Commencer gratuitement <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-zinc-100">
        <div className="max-w-4xl mx-auto px-6 py-10 grid grid-cols-3 gap-6">
          {page.stats.map((stat, i) => (
            <div key={i} className="text-center">
              <p className="font-display font-black text-3xl sm:text-4xl text-swiipr-gradient mb-1">
                {stat.value}
              </p>
              <p className="text-xs text-zinc-500 leading-snug">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Challenges */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Le problème</p>
            <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-6">
              Les obstacles que vous rencontrez
            </h2>
            <ul className="space-y-3">
              {page.challenges.map((c, i) => (
                <li key={i} className="flex items-start gap-3 text-zinc-600 text-sm leading-relaxed">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-zinc-300 flex-shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-linkedin uppercase tracking-widest mb-3">La solution Hirly</p>
            <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-6">
              Ce que Hirly fait pour vous
            </h2>
            <ul className="space-y-3">
              {page.solutions.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-linkedin flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 mb-0.5">{s.title}</p>
                    <p className="text-sm text-zinc-500 leading-relaxed">{s.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA mid */}
      <section className="max-w-5xl mx-auto px-6 mb-16">
        <div className="rounded-3xl gradient-linkedin text-white px-8 py-10 flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left">
          <div className="flex-1">
            <h2 className="font-display font-bold text-xl mb-1">Essayer Hirly gratuitement</h2>
            <p className="text-white/70 text-sm">Créez votre profil en 2 minutes. Commencez à swiper.</p>
          </div>
          <button
            onClick={() => startGoogleLogin("/swipe")}
            className="flex-shrink-0 inline-flex items-center gap-2 bg-white text-zinc-900 font-semibold rounded-full px-5 py-2.5 text-sm hover:bg-zinc-50 transition-colors"
          >
            Commencer <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-2xl mx-auto px-6 pb-20">
        <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-6 text-center">
          Questions fréquentes
        </h2>
        <MarketingFaq items={page.faq} />
      </section>
    </MarketingLayout>
  );
}
