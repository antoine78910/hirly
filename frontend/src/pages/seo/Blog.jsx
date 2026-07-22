import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import { blogPosts } from "../../lib/seo/blogPosts";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Blog",
  name: "Hirly Blog",
  description: "Conseils, méthodes et guides pour trouver un emploi plus vite avec l'IA.",
  url: "https://tryhirly.com/blog",
  publisher: {
    "@type": "Organization",
    name: "Hirly",
    url: "https://tryhirly.com",
  },
};

const categoryColors = {
  "Recherche d'emploi": "bg-blue-50 text-blue-700",
  Outils: "bg-violet-50 text-violet-700",
  Productivité: "bg-emerald-50 text-emerald-700",
  Stratégie: "bg-amber-50 text-amber-700",
  Tendances: "bg-pink-50 text-pink-700",
};

export default function Blog() {
  const [featured, ...rest] = blogPosts;

  return (
    <MarketingLayout>
      <SEOHead
        title="Blog — Conseils pour trouver un emploi | Hirly"
        description="Méthodes, guides et conseils pour trouver un emploi plus vite avec l'IA. Articles sur la recherche d'emploi, les ATS, le matching et l'automatisation."
        canonical="/blog"
        jsonLd={jsonLd}
      />

      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="font-display font-black text-4xl sm:text-5xl tracking-tight mb-3">
            Blog Hirly
          </h1>
          <p className="text-zinc-500 text-lg max-w-xl">
            Méthodes concrètes pour trouver un emploi plus vite — sans envoyer 200 CVs.
          </p>
        </div>

        {/* Featured article */}
        <Link
          to={`/blog/${featured.slug}`}
          className="group block rounded-3xl border border-zinc-200 bg-white overflow-hidden hover:border-zinc-300 hover:shadow-md transition-all duration-200 mb-12"
        >
          <div className="gradient-linkedin-soft px-8 py-12 sm:px-12 sm:py-16">
            <div className="flex items-center gap-3 mb-4">
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${categoryColors[featured.category] ?? "bg-zinc-100 text-zinc-600"}`}
              >
                {featured.category}
              </span>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <Clock className="w-3.5 h-3.5" />
                {featured.readTime}
              </span>
            </div>
            <h2 className="font-display font-black text-2xl sm:text-3xl lg:text-4xl tracking-tight mb-4 max-w-2xl">
              {featured.title}
            </h2>
            <p className="text-zinc-600 text-base leading-relaxed max-w-xl mb-6">
              {featured.intro.slice(0, 160)}…
            </p>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-linkedin group-hover:gap-3 transition-all">
              Lire l'article <ArrowRight className="w-4 h-4" />
            </span>
          </div>
        </Link>

        {/* Article grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {rest.map((post) => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 hover:border-zinc-300 hover:shadow-sm transition-all duration-200"
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${categoryColors[post.category] ?? "bg-zinc-100 text-zinc-600"}`}
                >
                  {post.category}
                </span>
                <span className="flex items-center gap-1 text-xs text-zinc-400">
                  <Clock className="w-3 h-3" />
                  {post.readTime}
                </span>
              </div>
              <h3 className="font-display font-bold text-base leading-snug mb-2 flex-1">
                {post.title}
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed mb-4 line-clamp-2">
                {post.intro.slice(0, 120)}…
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-linkedin group-hover:gap-2.5 transition-all">
                Lire <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
