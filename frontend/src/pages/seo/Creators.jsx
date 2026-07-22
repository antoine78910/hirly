import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Play,
  Heart,
  Bookmark,
  Share2,
  DollarSign,
  Eye,
  Users,
  Sparkles,
  UploadCloud,
  Wand2,
  Banknote,
  TrendingUp,
} from "lucide-react";
import MarketingLayout from "../../components/marketing/MarketingLayout";
import SEOHead from "../../components/seo/SEOHead";
import MarketingFaq from "../../components/marketing/MarketingFaq";
import {
  topCreatorVideos,
  totalViews,
  totalEarnings,
  creatorCount,
  formatViews,
  formatEarnings,
  VIRAL_VIEWS_THRESHOLD,
} from "../../lib/seo/creatorsData";

const steps = [
  {
    icon: UploadCloud,
    step: "01",
    title: "Tu postules en 2 minutes",
    body: "Envoie-nous un lien vers tes réseaux (TikTok, Instagram...). Pas besoin d'être déjà énorme : on cherche des voix authentiques sur la recherche d'emploi, pas des millions de followers.",
  },
  {
    icon: Wand2,
    step: "02",
    title: "On te donne accès + un brief",
    body: "Accès gratuit à Hirly, des angles de contenu qui marchent déjà (voir plus bas), et une totale liberté créative. Tu gardes ton ton, ton format, ta voix.",
  },
  {
    icon: Sparkles,
    step: "03",
    title: "Tu postes du contenu authentique",
    body: "Tu partages ta vraie expérience : comment Hirly t'a aidé (ou aiderait) à postuler plus vite. Le contenu le plus honnête est aussi celui qui performe le mieux.",
  },
  {
    icon: Banknote,
    step: "04",
    title: "Tu es payée sur tes vues",
    body: "1$ de CPM, sans plafond. Une vidéo à 235K vues, c'est 235$. Pas de minimum de followers, pas de quota — juste tes vues, payées chaque mois.",
  },
];

const faq = [
  {
    id: 1,
    question: "Faut-il déjà avoir beaucoup de followers pour candidater ?",
    answer:
      "Non. Nos meilleures créatrices actuelles ont commencé avec moins de 200 followers. Ce qu'on regarde, c'est l'authenticité et la qualité du contenu — pas la taille de l'audience de départ.",
  },
  {
    id: 2,
    question: "Comment est calculée la rémunération ?",
    answer:
      "1$ de CPM (coût pour mille vues) sur chaque vidéo publiée dans le cadre du programme, sans plafond. Plus la vidéo performe, plus tu es payée — certaines de nos créatrices ont déjà touché plus de 200$ sur une seule vidéo.",
  },
  {
    id: 3,
    question: "Sur quelles plateformes doit-on poster ?",
    answer:
      "TikTok et Instagram (Reels) sont les deux plateformes du programme aujourd'hui. Tu peux poster sur l'une, l'autre, ou les deux.",
  },
  {
    id: 4,
    question: "Est-ce qu'on doit suivre un script ?",
    answer:
      "Non, aucun script imposé. On te donne des angles qui ont déjà bien marché (voir les exemples ci-dessus) à titre d'inspiration, mais le format, le ton et la mise en scène restent entièrement les tiens.",
  },
  {
    id: 5,
    question: "Quand et comment est-on payée ?",
    answer:
      "Le paiement est calculé sur les vues cumulées de tes vidéos chaque mois et versé directement par virement. Tu gardes un accès à tes statistiques à tout moment.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Programme créateurs Hirly — Sois payée pour parler de recherche d'emploi",
  description:
    "Rejoins le programme créateurs Hirly : poste du contenu authentique sur la recherche d'emploi, et sois payée 1$ pour 1000 vues, sans plafond.",
  url: "https://tryhirly.com/creators",
  publisher: { "@type": "Organization", name: "Hirly", url: "https://tryhirly.com" },
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

function StatPill({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4">
      <div className="w-10 h-10 rounded-xl gradient-linkedin text-white grid place-items-center shrink-0">
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div>
        <p className="font-display font-black text-xl leading-tight tracking-tight">{value}</p>
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

function VideoCard({ video, featured }) {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative flex flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-950 hover:border-zinc-300 hover:shadow-lg transition-all duration-200 ${
        featured ? "aspect-[9/13]" : "aspect-[9/14]"
      }`}
    >
      <img
        src={video.thumbnail}
        alt={video.caption}
        className="absolute inset-0 h-full w-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.03] transition-all duration-300"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/40" />

      {/* Earnings badge — only for videos viral enough that the payout is impressive */}
      {video.views >= VIRAL_VIEWS_THRESHOLD && (
        <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] font-bold text-zinc-900 shadow-sm">
          <DollarSign className="w-3 h-3 text-emerald-600" />
          {formatEarnings(video.views)}
        </div>
      )}

      {/* Play affordance */}
      <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-12 h-12 rounded-full bg-white/90 grid place-items-center">
          <Play className="w-5 h-5 text-zinc-900 fill-zinc-900 ml-0.5" />
        </div>
      </div>

      <div className="relative mt-auto p-4 text-white">
        <p className="text-[13px] font-medium leading-snug line-clamp-3 mb-2.5">{video.caption}</p>
        <div className="flex items-center justify-between text-[11px] text-white/80">
          <span className="font-semibold">{video.handle}</span>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {formatViews(video.views)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {formatViews(video.likes)}
            </span>
            <span className="flex items-center gap-1">
              <Bookmark className="w-3 h-3" />
              {formatViews(video.saves)}
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}

export default function Creators() {
  const [top4, rest] = [topCreatorVideos.slice(0, 4), topCreatorVideos.slice(4)];

  return (
    <MarketingLayout>
      <SEOHead
        title="Programme créateurs Hirly — Sois payée pour parler de recherche d'emploi"
        description="Rejoins le programme créateurs Hirly : poste du contenu authentique sur la recherche d'emploi, et sois payée 1$ pour 1000 vues, sans plafond."
        canonical="/creators"
        jsonLd={[jsonLd, faqLd]}
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
              Programme créateurs
            </p>
            <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.05] mb-5">
              Poste une vidéo.{" "}
              <span className="italic text-swiipr-gradient">
                Jusqu'à 400$ dès ta première semaine.
              </span>
            </h1>
            <p className="text-zinc-600 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-8">
              Rejoins le programme créateurs Hirly : partage ton expérience de la recherche d'emploi
              sur TikTok et Instagram, et sois payée sur tes vues — sans plafond, sans minimum de
              followers.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/creators/apply"
                className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-6 py-3 text-base hover:opacity-90 transition-opacity"
              >
                Candidater maintenant <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#exemples"
                className="inline-flex items-center gap-2 rounded-full border border-zinc-300 text-zinc-700 font-semibold px-6 py-3 text-base hover:border-zinc-400 transition-colors"
              >
                Voir les résultats
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="max-w-5xl mx-auto px-6 -mt-8 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatPill icon={Eye} label="vues générées" value={`${formatViews(totalViews)}+`} />
          <StatPill icon={DollarSign} label="déjà versés (1$ CPM)" value={`$${totalEarnings}+`} />
          <StatPill icon={Users} label="créatrices actives" value={creatorCount} />
          <StatPill icon={TrendingUp} label="plafond de gains" value="Aucun" />
        </div>
      </section>

      {/* Video showcase */}
      <section id="exemples" className="max-w-5xl mx-auto px-6 py-20 scroll-mt-20">
        <div className="text-center max-w-xl mx-auto mb-10">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-3">
            Le contenu de nos créatrices, en vrai
          </h2>
          <p className="text-zinc-500 leading-relaxed">
            Aucune mise en scène de studio — juste des vidéos filmées au téléphone qui parlent à
            ceux qui cherchent un emploi. Voici les 4 vidéos qui ont le mieux marché, avec ce
            qu'elles ont rapporté à 1$ le CPM.
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {top4.map((video) => (
            <VideoCard key={video.id} video={video} featured />
          ))}
        </div>
        {rest.length > 0 && (
          <>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4 mt-10">
              Et bien d'autres, chaque mois
            </p>
            <div className="grid grid-cols-3 lg:grid-cols-3 gap-4">
              {rest.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* How it works */}
      <section className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-center mb-12">
            Comment ça marche
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="rounded-2xl border border-zinc-200 bg-white p-6"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-mono font-semibold text-zinc-300">
                      {step.step}
                    </span>
                    <div className="w-9 h-9 rounded-xl gradient-linkedin text-white grid place-items-center">
                      <Icon className="w-4.5 h-4.5" />
                    </div>
                  </div>
                  <h3 className="font-display font-bold text-lg tracking-tight mb-2">
                    {step.title}
                  </h3>
                  <p className="text-zinc-500 text-sm leading-relaxed">{step.body}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Why join */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mb-4">
              Pourquoi les créatrices Hirly restent
            </h2>
            <ul className="space-y-3">
              {[
                "1$ de CPM sur chaque vidéo, sans plafond de gains",
                "Aucun minimum de followers pour candidater",
                "Liberté créative totale — ton format, ton ton",
                "Accès gratuit à Hirly pour parler de ton vécu réel",
                "Paiement mensuel basé sur tes vues cumulées",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-600">
                  <Share2 className="w-4 h-4 text-linkedin flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl gradient-linkedin-soft border border-zinc-200 p-8">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
              Exemple concret
            </p>
            <p className="font-display font-black text-3xl tracking-tight mb-2">235 700 vues</p>
            <p className="text-sm text-zinc-500 mb-5">
              = {formatEarnings(235700)} pour une seule vidéo, tournée au téléphone en quelques
              minutes.
            </p>
            <p className="font-display font-black text-3xl tracking-tight mb-2">455K+ vues</p>
            <p className="text-sm text-zinc-500">
              cumulées sur nos 7 dernières vidéos créateurs — {`$${totalEarnings}+`} déjà versés à
              nos créatrices.
            </p>
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
              Prête à être payée pour ta prochaine vidéo ?
            </h2>
            <p className="text-zinc-500 mb-7">Envoie-nous ton profil. Réponse sous 48h.</p>
            <Link
              to="/creators/apply"
              className="inline-flex items-center gap-2 rounded-full gradient-linkedin text-white font-semibold px-7 py-3 text-base hover:opacity-90 transition-opacity"
            >
              Candidater au programme <ArrowRight className="w-4 h-4" />
            </Link>
            <p className="mt-6 text-xs text-zinc-400">
              Tu es déjà utilisatrice de Hirly ?{" "}
              <Link to="/referral" className="underline hover:text-zinc-600">
                Découvre aussi notre programme de parrainage
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
