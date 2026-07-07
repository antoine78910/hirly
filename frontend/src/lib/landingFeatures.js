export function getLandingFeaturesCopy(lang) {
  if (lang === "fr") {
    return {
      badge: "Découvrez Hirly",
      title: "Votre recherche d'emploi, partout avec vous.",
      titleMuted: "Postulez plus vite et suivez tout depuis votre téléphone.",
      subtitle:
        "L'app Hirly met toute votre recherche dans votre poche — trouvez des offres, générez des candidatures personnalisées et suivez chaque poste sans effort.",
      features: [
        {
          id: "personalization",
          title: "Personnalisation",
          lead: "Démarquez-vous avec des candidatures sur mesure.",
          body: "Hirly génère un CV et une lettre de motivation adaptés à chaque offre, au rôle et à l'entreprise.",
        },
        {
          id: "auto_apply",
          title: "Candidature auto",
          lead: "Postulez en un swipe.",
          body: "Fini les formulaires interminables. Hirly prépare et envoie vos candidatures pour vous, et vous fait gagner des heures chaque semaine.",
        },
        {
          id: "tracking",
          title: "Suivi",
          lead: "Chaque candidature, suivie automatiquement.",
          body: "Hirly garde toute votre recherche organisée dans un seul tableau de bord simple.",
        },
      ],
      highlights: [
        {
          id: "secure",
          title: "Sécurisé par design",
          body: "Vos données et candidatures restent protégées.",
        },
        {
          id: "sync",
          title: "Sync en temps réel",
          body: "Vos mises à jour se synchronisent sur tous vos appareils.",
        },
        {
          id: "dashboard",
          title: "Tableau de bord unifié",
          body: "Offres, statuts, emails et documents au même endroit.",
        },
        {
          id: "cover_letters",
          title: "Lettres IA",
          body: "Des lettres personnalisées générées en quelques secondes.",
        },
        {
          id: "resume",
          title: "CV toujours à jour",
          body: "Votre profil reste aligné avec vos compétences et expériences.",
        },
        {
          id: "insights",
          title: "Insights IA",
          body: "Voyez ce qui fonctionne et où vous obtenez le plus de réponses.",
        },
        {
          id: "experience",
          title: "Expérience fluide",
          body: "Recherche, candidature et suivi dans un seul flux.",
        },
        {
          id: "everywhere",
          title: "Partout avec vous",
          body: "Web et mobile — votre progression reste synchronisée.",
        },
      ],
      trackerCards: [
        { company: "Doctolib", role: "Product Manager", location: "Paris", status: "Interview", statusTone: "purple", activity: "Entretien prévu demain" },
        { company: "L'Oréal", role: "Marketing Analyst", location: "Remote", status: "Applied", statusTone: "blue", activity: "Candidature envoyée il y a 3 jours" },
        { company: "BNP Paribas", role: "Data Analyst", location: "Lyon", status: "Offer", statusTone: "indigo", activity: "Offre reçue cette semaine" },
        { company: "Mistral AI", role: "Growth Intern", location: "Paris", status: "Pending", statusTone: "amber", activity: "Action requise" },
      ],
      aiApplySuccess: "Votre candidature a été envoyée !",
      aiGenerating: "Génération en cours…",
    };
  }

  return {
    badge: "Meet Hirly",
    title: "Your job search, on the go.",
    titleMuted: "Apply faster and track everything from your phone.",
    subtitle:
      "The Hirly mobile app puts the entire job search in your pocket — find roles, generate tailored applications, and track every job effortlessly.",
    features: [
      {
        id: "personalization",
        title: "Personalization",
        lead: "Stand out with personalized applications.",
        body: "Hirly generates tailored cover letters and resumes for every job, customized to the role and company.",
      },
      {
        id: "auto_apply",
        title: "AI Apply",
        lead: "Apply to jobs in one tap.",
        body: "Skip the forms. Hirly automatically prepares and submits applications for you, saving hours every week.",
      },
      {
        id: "tracking",
        title: "Tracking",
        lead: "Every application, tracked automatically.",
        body: "Hirly keeps your entire job search organized in one easy-to-use dashboard.",
      },
    ],
    highlights: [
      { id: "secure", title: "Secure by Design", body: "Your data and applications stay encrypted and protected." },
      { id: "sync", title: "Real-Time Sync", body: "Updates automatically across devices." },
      { id: "dashboard", title: "Unified Dashboard", body: "View every job, status, email, and document in one place." },
      { id: "cover_letters", title: "AI Cover Letters", body: "Personalized, role-specific cover letters generated in seconds." },
      { id: "resume", title: "Auto Resume Updates", body: "Your resume stays current with new skills and experience." },
      { id: "insights", title: "AI Insights", body: "See what's working and where you get the best results." },
      { id: "experience", title: "Seamless Experience", body: "Search, apply, and track in one integrated flow." },
      { id: "everywhere", title: "Works Everywhere", body: "Use Hirly across web and mobile — your progress stays synced." },
    ],
    trackerCards: [
      { company: "Doctolib", role: "Product Manager", location: "Remote", status: "Interview", statusTone: "purple", activity: "Interview scheduled tomorrow" },
      { company: "L'Oréal", role: "Marketing Analyst", location: "Paris", status: "Applied", statusTone: "blue", activity: "Applied 3 days ago" },
      { company: "BNP Paribas", role: "Data Analyst", location: "Lyon", status: "Offer", statusTone: "indigo", activity: "Offer received this week" },
      { company: "Mistral AI", role: "Growth Intern", location: "Paris", status: "Pending", statusTone: "amber", activity: "Pending action" },
    ],
    aiApplySuccess: "Your application has been submitted!",
    aiGenerating: "Generating...",
  };
}
