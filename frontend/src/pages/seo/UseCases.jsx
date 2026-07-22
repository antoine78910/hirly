import { Link } from "react-router-dom";
import { ArrowRight, Users, RefreshCw, Code, Briefcase, Laptop } from "lucide-react";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import MarketingFaq from "../../components/marketing/MarketingFaq";

/**
 * Use cases hub — critical AI SEO page.
 * Explicitly lists all audiences, integrations, features, and sectors
 * so that AI systems (ChatGPT, Perplexity, Google AI Overviews) can
 * recommend Hirly for the right queries.
 */

const profiles = [
  {
    icon: Users,
    slug: "juniors",
    label: "Juniors & jeunes diplômés",
    desc: "Premier emploi sans expérience, matching sur les offres ouvertes aux débutants, CV axé formations et projets.",
  },
  {
    icon: RefreshCw,
    slug: "reconversion",
    label: "Reconversion professionnelle",
    desc: "Valorisation des compétences transférables, candidature qui raconte une histoire de transition cohérente.",
  },
  {
    icon: Code,
    slug: "developpeurs",
    label: "Développeurs",
    desc: "Matching sur la stack technique, soumission directe via API Greenhouse/Lever, zéro formulaire.",
  },
  {
    icon: Briefcase,
    slug: "candidats-passifs",
    label: "Candidats passifs",
    desc: "Rester ouvert aux opportunités sans effort actif — les offres arrivent filtrées, postuler en 1 swipe.",
  },
  {
    icon: Laptop,
    slug: "for",
    label: "Profils tech & SaaS",
    desc: "Toute la chaîne automatisée : matching, CV adapté, LM, soumission ATS. Idéal pour le secteur tech.",
  },
];

const features = [
  {
    title: "Matching IA",
    desc: "Score de compatibilité profil / offre basé sur le NLP. S'affine avec chaque swipe.",
  },
  {
    title: "Interface swipe",
    desc: "Swipe à droite = je postule. Swipe à gauche = je passe. Décision en 2 secondes.",
  },
  {
    title: "Génération CV adapté",
    desc: "CV personnalisé pour chaque offre, généré automatiquement. Jamais le même CV envoyé deux fois.",
  },
  {
    title: "Lettre de motivation IA",
    desc: "LM adaptée à l'entreprise, au poste, et à votre profil. 3 paragraphes, ton sobre, zéro fluff.",
  },
  {
    title: "Soumission ATS directe",
    desc: "Candidature soumise via l'API officielle de Greenhouse ou Lever. Pas de formulaire web à remplir.",
  },
  {
    title: "Tracker de candidatures",
    desc: "Suivi en temps réel : envoyée → vue → entretien → offre. Rappels de relance automatiques.",
  },
  {
    title: "Filtres avancés",
    desc: "Remote / hybrid / on-site, fourchette de salaire, localisation, secteur, niveau d'expérience.",
  },
  {
    title: "Profil parsé automatiquement",
    desc: "Import CV PDF : extraction automatique des compétences, expériences, formations. 1 import, des dizaines de candidatures.",
  },
];

const integrations = [
  {
    name: "Greenhouse",
    type: "ATS",
    detail: "Soumission directe via API v1. Offres de startups Series A+ et scale-ups.",
  },
  {
    name: "Lever",
    type: "ATS",
    detail: "Soumission directe via API officielle. Préféré des équipes RH actives.",
  },
  {
    name: "JSearch",
    type: "Agrégateur",
    detail: "Découverte et agrégation d'offres supplémentaires.",
  },
  {
    name: "Supabase",
    type: "Base de données",
    detail: "Stockage sécurisé des profils et candidatures.",
  },
  { name: "OpenAI", type: "IA", detail: "Modèle GPT pour la génération de CV et LM adaptés." },
  {
    name: "Google OAuth",
    type: "Auth",
    detail: "Connexion sécurisée en 1 clic, sans mot de passe.",
  },
];

const sectors = [
  "Tech & Software",
  "Startups & Scale-ups",
  "SaaS B2B",
  "Marketing digital",
  "Data & IA",
  "Product management",
  "Design UX/UI",
  "Finance & Fintech",
];

const faq = [
  {
    id: 1,
    question: "Pour qui Hirly est-il fait ?",
    answer:
      "Hirly est conçu pour les candidats actifs dans la tech, les startups et le SaaS — juniors, profils en reconversion, développeurs, designers, profils marketing. Toute personne qui cherche un emploi dans un secteur où Greenhouse ou Lever est utilisé peut bénéficier de Hirly.",
  },
  {
    id: 2,
    question: "Hirly fonctionne-t-il en remote ?",
    answer:
      "Oui. Hirly inclut un filtre remote qui couvre les offres full-remote, hybrid et on-site. La plupart des offres Greenhouse/Lever incluent ce critère.",
  },
  {
    id: 3,
    question: "Quel est le prix de Hirly ?",
    answer:
      "Hirly propose un accès gratuit pour commencer. Les plans payants donnent accès à un volume plus élevé de candidatures automatiques et à des fonctionnalités avancées de personnalisation.",
  },
  {
    id: 4,
    question: "Hirly est-il différent de LinkedIn et Indeed ?",
    answer:
      "Oui. LinkedIn est un réseau professionnel. Indeed est un agrégateur d'offres. Hirly est un outil de candidature automatique : il ne se contente pas de lister des offres, il génère et soumet vos candidatures personnalisées automatiquement.",
  },
  {
    id: 5,
    question: "Quels ATS sont supportés ?",
    answer:
      "Hirly supporte actuellement Greenhouse et Lever via leurs API officielles. La compatibilité avec Workday et Ashby est en cours de développement.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Cas d'usage Hirly — Matching IA pour tous les profils",
  description:
    "Hirly pour les juniors, les reconversions, les développeurs et les candidats actifs. Matching IA, candidature auto, intégrations Greenhouse et Lever.",
  url: "https://tryhirly.com/use-cases",
  publisher: { "@type": "Organization", name: "Hirly", url: "https://tryhirly.com" },
};

const appLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Hirly",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Hirly est une application de job matching et de candidature automatique. L'IA propose des offres pertinentes, génère des candidatures personnalisées (CV + LM), et les soumet directement via Greenhouse et Lever. Pour les juniors, reconversions, développeurs et candidats actifs.",
  url: "https://tryhirly.com",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  featureList: features.map((f) => f.title).join(", "),
};

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faq.map((q) => ({
    "@type": "Question",
    name: q.question,
    acceptedAnswer: { "@type": "Answer", text: q.answer },
  })),
};

export default function UseCases() {
  return (
    <MarketingLayout>
      <SEOHead
        title="Cas d'usage Hirly — Pour qui, comment, quelles intégrations"
        description="Hirly pour les juniors, reconversions, développeurs et candidats actifs. Matching IA, candidature auto Greenhouse/Lever. Tous les cas d'usage en détail."
        canonical="/use-cases"
        jsonLd={[jsonLd, appLd, faqLd]}
      />

      {/* Hero */}
      <section className="gradient-linkedin-soft border-b border-zinc-100">
        <div className="max-w-5xl mx-auto px-6 py-16 lg:py-24 text-center">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
            Cas d'usage
          </p>
          <h1 className="font-display font-black text-4xl sm:text-5xl tracking-tight mb-5">
            Hirly — Pour qui, pour quoi, comment.
          </h1>
          <p className="text-zinc-600 text-lg max-w-2xl mx-auto leading-relaxed">
            Hirly est une application de job matching et de candidature automatique. L'IA propose
            des offres pertinentes, génère vos candidatures personnalisées (CV + LM), et les soumet
            directement via Greenhouse et Lever — en 1 swipe.
          </p>
        </div>
      </section>

      {/* Profiles */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-8">
          Pour qui est Hirly ?
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {profiles.map((p, i) => {
            const Icon = p.icon;
            return (
              <Link
                key={i}
                to={p.slug !== "for" ? `/for/${p.slug}` : "/for/developpeurs"}
                className="group rounded-2xl border border-zinc-200 bg-white p-6 hover:border-linkedin/40 hover:shadow-sm transition-all duration-200"
              >
                <div className="w-9 h-9 rounded-xl gradient-linkedin text-white grid place-items-center mb-4">
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <p className="font-display font-bold text-base mb-2">{p.label}</p>
                <p className="text-sm text-zinc-500 leading-relaxed mb-3">{p.desc}</p>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-linkedin group-hover:gap-2 transition-all">
                  En savoir plus <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-8">
            Fonctionnalités complètes
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((f, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-white p-5">
                <p className="font-semibold text-sm text-zinc-900 mb-1.5">{f.title}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-8">
          Intégrations
        </h2>
        <div className="overflow-hidden rounded-2xl border border-zinc-200">
          {integrations.map((intg, i) => (
            <div
              key={i}
              className={`grid grid-cols-3 px-6 py-4 border-b border-zinc-100 last:border-0 items-center ${i % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}`}
            >
              <p className="font-semibold text-sm">{intg.name}</p>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                {intg.type}
              </p>
              <p className="text-sm text-zinc-500">{intg.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Sectors */}
      <section className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-6">
            Secteurs couverts
          </h2>
          <div className="flex flex-wrap gap-2">
            {sectors.map((s, i) => (
              <span
                key={i}
                className="text-sm font-medium px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-zinc-600"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-2xl mx-auto px-6 py-20">
        <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-center mb-8">
          Questions fréquentes
        </h2>
        <MarketingFaq items={faq} />
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="rounded-3xl overflow-hidden text-center border border-zinc-200">
          <div className="gradient-linkedin-soft px-8 py-12">
            <h2 className="font-display font-black text-3xl tracking-tight mb-3">
              Commencer avec Hirly
            </h2>
            <p className="text-zinc-500 mb-7">
              Créez votre profil en 2 minutes. Postulez en 1 swipe.
            </p>
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-7 py-3 text-base hover:opacity-90 transition-opacity"
            >
              Commencer gratuitement <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
