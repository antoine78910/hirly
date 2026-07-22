import { Link } from "react-router-dom";
import { ArrowRight, Upload, Zap, Inbox, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import MarketingFaq from "../../components/marketing/MarketingFaq";

const steps = [
  {
    icon: Upload,
    step: "01",
    title: "Importez votre CV une seule fois",
    body: "Uploadez votre CV PDF ou remplissez votre profil. Hirly extrait automatiquement vos compétences, expériences, formations et préférences. Vous ne faites ça qu'une seule fois.",
    details: [
      "Extraction automatique des compétences techniques et soft skills",
      "Identification des secteurs et types de postes correspondants",
      "Détection des préférences : remote, localisation, fourchette de salaire",
    ],
  },
  {
    icon: Zap,
    step: "02",
    title: "Swipez les offres qui correspondent",
    body: "Hirly vous propose des offres avec un score de matching basé sur votre profil. Swipez à droite pour postuler, à gauche pour passer. Chaque swipe affine l'algorithme.",
    details: [
      "Score de matching expliqué : pourquoi cette offre correspond à votre profil",
      "Filtres : remote, localisation, salaire, secteur, niveau d'expérience",
      "L'algorithme apprend de votre comportement pour affiner les propositions",
    ],
  },
  {
    icon: Inbox,
    step: "03",
    title: "Hirly génère et envoie votre candidature",
    body: "Un swipe à droite déclenche la génération automatique de votre CV adapté et votre lettre de motivation personnalisée. La candidature est soumise directement à l'ATS du recruteur via l'API officielle.",
    details: [
      "CV adapté : met en avant les compétences correspondant à l'offre",
      "LM personnalisée : rédigée pour ce poste, cette entreprise, ce contexte",
      "Soumission ATS : Greenhouse et Lever via API officielle",
    ],
  },
  {
    icon: CheckCircle,
    step: "04",
    title: "Suivez tout au même endroit",
    body: "Chaque candidature envoyée est trackée en temps réel. Statut, historique, rappels de relance : tout est dans votre tableau de bord Hirly.",
    details: [
      "Statut en temps réel : envoyée → vue → entretien → offre",
      "Rappels automatiques pour relancer au bon moment",
      "Historique complet de chaque candidature et des échanges",
    ],
  },
];

const integrations = [
  { name: "Greenhouse", desc: "ATS #1 des startups Series A+" },
  { name: "Lever", desc: "ATS favori des équipes RH actives" },
  { name: "JSearch", desc: "Découverte et agrégation d'offres" },
  { name: "Google OAuth", desc: "Connexion sécurisée en 1 clic" },
];

const faq = [
  {
    id: 1,
    question: "Hirly fonctionne-t-il pour tous les secteurs ?",
    answer:
      "Hirly est principalement optimisé pour la tech, les startups, le SaaS et le marketing digital. Les secteurs qui utilisent Greenhouse ou Lever sont bien couverts. Les secteurs très traditionnels (industrie lourde, administration, santé) sont moins bien représentés.",
  },
  {
    id: 2,
    question: "Ma candidature est-elle vraiment personnalisée à chaque offre ?",
    answer:
      "Oui. Pour chaque offre que vous swipez à droite, Hirly génère un CV qui met en avant les compétences et expériences les plus pertinentes pour ce poste spécifique, et une lettre de motivation adaptée à l'entreprise et au contexte. Ce n'est pas un template générique.",
  },
  {
    id: 3,
    question: "Les recruteurs voient-ils que j'utilise Hirly ?",
    answer:
      "Non. La candidature est soumise via l'API officielle de l'ATS, exactement comme si vous l'aviez remplie manuellement. L'outil est invisible côté recruteur.",
  },
  {
    id: 4,
    question: "Peut-on modifier la candidature avant qu'elle soit envoyée ?",
    answer:
      "Oui. Hirly propose un mode prévisualisation pour revoir le CV et la LM générés avant l'envoi. Vous pouvez modifier ou annuler chaque candidature avant soumission.",
  },
  {
    id: 5,
    question: "Combien d'offres peut-on voir par jour ?",
    answer:
      "Le nombre d'offres proposées dépend de votre profil et de vos critères. Le volume de candidatures automatiques envoyées dépend de votre plan (gratuit ou payant).",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Comment fonctionne Hirly — Matching IA et candidature automatique",
  description:
    "Hirly : importez votre CV, swipez les offres compatibles, et l'IA génère et soumet vos candidatures automatiquement via Greenhouse et Lever.",
  url: "https://tryhirly.com/how-it-works",
  publisher: { "@type": "Organization", name: "Hirly", url: "https://tryhirly.com" },
};

const appLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Hirly",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Application de job matching et de candidature automatique. Swipez les offres, l'IA génère et soumet vos candidatures via ATS en 1 tap.",
  url: "https://tryhirly.com",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
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

export default function HowItWorks() {
  return (
    <MarketingLayout>
      <SEOHead
        title="Comment fonctionne Hirly — Matching IA + Candidature automatique"
        description="Hirly : importez votre CV une fois, swipez les offres compatibles, et l'IA génère et soumet vos candidatures directement via Greenhouse et Lever en 1 swipe."
        canonical="/how-it-works"
        jsonLd={[jsonLd, appLd, faqLd]}
      />

      {/* Hero */}
      <section className="gradient-linkedin-soft border-b border-zinc-100">
        <div className="max-w-5xl mx-auto px-6 py-20 lg:py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
              Comment ça marche
            </p>
            <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.05] mb-5">
              Swipe. Match. <span className="italic text-swiipr-gradient">Get hired.</span>
            </h1>
            <p className="text-zinc-600 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-8">
              Hirly combine le matching IA et la candidature automatique pour vous faire postuler à
              10 offres pertinentes en 10 minutes — sans remplir un seul formulaire.
            </p>
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-6 py-3 text-base hover:opacity-90 transition-opacity"
            >
              Commencer gratuitement <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Steps */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="space-y-16">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isEven = i % 2 === 0;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className={`grid md:grid-cols-2 gap-10 items-center ${isEven ? "" : "md:[&>*:first-child]:order-2"}`}
              >
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-mono font-semibold text-zinc-300">
                      {step.step}
                    </span>
                    <div className="w-9 h-9 rounded-xl gradient-linkedin text-white grid place-items-center">
                      <Icon className="w-4.5 h-4.5" />
                    </div>
                  </div>
                  <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-3">
                    {step.title}
                  </h2>
                  <p className="text-zinc-500 leading-relaxed mb-5">{step.body}</p>
                  <ul className="space-y-2">
                    {step.details.map((d, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-sm text-zinc-600">
                        <CheckCircle className="w-4 h-4 text-linkedin flex-shrink-0 mt-0.5" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
                <div
                  className={`rounded-3xl border border-zinc-200 bg-zinc-50 h-52 grid place-items-center ${isEven ? "gradient-linkedin-soft" : ""}`}
                >
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-2xl gradient-linkedin text-white grid place-items-center mx-auto mb-3">
                      <Icon className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-semibold text-zinc-400">Étape {step.step}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Integrations */}
      <section className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-center mb-10">
            Intégrations et stack technique
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {integrations.map((intg, i) => (
              <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-5 text-center">
                <p className="font-display font-bold text-base mb-1">{intg.name}</p>
                <p className="text-xs text-zinc-500">{intg.desc}</p>
              </div>
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
        <div className="rounded-3xl overflow-hidden border border-zinc-200 text-center">
          <div className="gradient-linkedin-soft px-8 py-12 sm:py-16">
            <h2 className="font-display font-black text-3xl sm:text-4xl tracking-tight mb-3">
              Prêt à postuler en 1 swipe ?
            </h2>
            <p className="text-zinc-500 mb-7">
              Créez votre profil en 2 minutes. Commencez à swiper.
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
