import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import MarketingFaq from "../../components/marketing/MarketingFaq";
import { getPostBySlug } from "../../lib/seo/blogPosts";

function Section({ section, index, totalSections, ctaMid }) {
  const showCta = index === Math.floor(totalSections / 2) - 1 && ctaMid;

  return (
    <>
      <section className="mb-10">
        <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-4 text-zinc-900">
          {section.h2}
        </h2>
        {section.body.map((p, i) => (
          <p key={i} className="text-zinc-600 leading-relaxed mb-3 text-base sm:text-[1.05rem]">
            {p}
          </p>
        ))}
        {section.list && (
          <ul className="mt-3 space-y-2 pl-1">
            {section.list.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-zinc-600 text-sm leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-linkedin flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        )}
        {section.numbered && (
          <ol className="mt-3 space-y-3 pl-1">
            {section.numbered.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-zinc-600 text-sm leading-relaxed">
                <span className="flex-shrink-0 w-6 h-6 rounded-full gradient-linkedin text-white text-xs font-bold grid place-items-center mt-0.5">
                  {i + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
        )}
      </section>

      {showCta && (
        <div className="my-10 rounded-2xl gradient-linkedin-soft border border-zinc-200 px-6 py-7 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1">
            <p className="font-display font-bold text-lg text-zinc-900">
              Prêt à postuler sans effort ?
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              Hirly génère et envoie vos candidatures automatiquement.
            </p>
          </div>
          <Link
            to={ctaMid.href}
            className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-5 py-2.5 text-sm hover:opacity-90 transition-opacity flex-shrink-0"
          >
            {ctaMid.text} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </>
  );
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = getPostBySlug(slug);

  if (!post) return <Navigate to="/blog" replace />;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "description": post.metaDescription,
    "datePublished": post.date,
    "dateModified": post.date,
    "mainEntityOfPage": { "@type": "WebPage", "@id": `https://tryhirly.com/blog/${post.slug}` },
    "publisher": { "@type": "Organization", "name": "Hirly", "url": "https://tryhirly.com" },
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": post.faq.map((q) => ({
      "@type": "Question",
      "name": q.question,
      "acceptedAnswer": { "@type": "Answer", "text": q.answer },
    })),
  };

  return (
    <MarketingLayout>
      <SEOHead
        title={`${post.metaTitle} | Hirly`}
        description={post.metaDescription}
        keywords={post.keywords}
        canonical={`/blog/${post.slug}`}
        jsonLd={[jsonLd, faqLd]}
      />

      <article className="max-w-2xl mx-auto px-6 py-14">
        {/* Back */}
        <Link to="/blog" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors mb-8">
          <ArrowLeft className="w-3.5 h-3.5" /> Tous les articles
        </Link>

        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-linkedin-light text-linkedin">
              {post.category}
            </span>
            <span className="flex items-center gap-1 text-xs text-zinc-400">
              <Clock className="w-3.5 h-3.5" /> {post.readTime}
            </span>
          </div>
          <h1 className="font-display font-black text-3xl sm:text-4xl tracking-tight leading-tight mb-5">
            {post.title}
          </h1>
          <p className="text-zinc-500 text-base sm:text-lg leading-relaxed border-l-2 border-zinc-200 pl-4 italic">
            {post.intro}
          </p>
        </header>

        {/* Sections */}
        {post.sections.map((section, i) => (
          <Section
            key={i}
            section={section}
            index={i}
            totalSections={post.sections.length}
            ctaMid={post.ctaMid}
          />
        ))}

        {/* FAQ */}
        <div className="mt-14">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-6">
            FAQ
          </h2>
          <MarketingFaq items={post.faq} />
        </div>

        {/* CTA final */}
        <div className="mt-14 rounded-3xl overflow-hidden border border-zinc-200">
          <div className="gradient-linkedin-soft px-7 py-10 text-center">
            <h2 className="font-display font-black text-2xl tracking-tight mb-2">
              Prêt à postuler en 1 swipe ?
            </h2>
            <p className="text-zinc-500 text-sm mb-6">
              Hirly génère vos candidatures et les envoie directement à l'ATS.
            </p>
            <Link
              to={post.ctaEnd.href}
              className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-6 py-2.5 text-sm hover:opacity-90 transition-opacity"
            >
              {post.ctaEnd.text} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </article>
    </MarketingLayout>
  );
}
