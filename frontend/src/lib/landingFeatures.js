export function getLandingFeaturesCopy(lang) {
  const locale = String(lang || "").trim().toLowerCase().split("-")[0];

  if (locale === "fr") {
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

  const localizedCatalogs = {
    de: {
      badge: "Entdecke Hirly", title: "Deine Jobsuche, überall dabei.", titleMuted: "Bewirb dich schneller und behalte alles auf deinem Smartphone im Blick.",
      subtitle: "Mit der Hirly App hast du deine gesamte Jobsuche in der Tasche — finde Stellen, erstelle maßgeschneiderte Bewerbungen und verfolge jede Stelle mühelos.",
      features: [
        { id: "personalization", title: "Personalisierung", lead: "Hebe dich mit individuellen Bewerbungen ab.", body: "Hirly erstellt für jede Stelle, Rolle und jedes Unternehmen einen passenden Lebenslauf und ein individuelles Anschreiben." },
        { id: "auto_apply", title: "KI-Bewerbung", lead: "Bewirb dich mit einem Swipe.", body: "Keine endlosen Formulare mehr. Hirly bereitet deine Bewerbungen vor und versendet sie für dich — so sparst du jede Woche Stunden." },
        { id: "tracking", title: "Übersicht", lead: "Jede Bewerbung automatisch im Blick.", body: "Hirly organisiert deine gesamte Jobsuche in einem einfachen Dashboard." },
      ],
      highlights: [
        { id: "secure", title: "Sicher entwickelt", body: "Deine Daten und Bewerbungen bleiben geschützt." },
        { id: "sync", title: "Echtzeit-Synchronisierung", body: "Deine Updates werden auf allen Geräten synchronisiert." },
        { id: "dashboard", title: "Zentrales Dashboard", body: "Stellen, Status, E-Mails und Dokumente an einem Ort." },
        { id: "cover_letters", title: "KI-Anschreiben", body: "Individuelle Anschreiben in Sekunden erstellt." },
        { id: "resume", title: "Immer aktueller Lebenslauf", body: "Dein Profil bleibt mit deinen Fähigkeiten und Erfahrungen auf dem neuesten Stand." },
        { id: "insights", title: "KI-Insights", body: "Sieh, was funktioniert und wo du die meisten Antworten erhältst." },
        { id: "experience", title: "Nahtlose Erfahrung", body: "Suchen, bewerben und verfolgen in einem einzigen Ablauf." },
        { id: "everywhere", title: "Überall dabei", body: "Web und Mobile — dein Fortschritt bleibt synchronisiert." },
      ],
      trackerCards: [
        { company: "Doctolib", role: "Product Manager", location: "Paris", status: "Vorstellungsgespräch", statusTone: "purple", activity: "Vorstellungsgespräch morgen" },
        { company: "L'Oréal", role: "Marketing Analyst", location: "Remote", status: "Beworben", statusTone: "blue", activity: "Vor 3 Tagen beworben" },
        { company: "BNP Paribas", role: "Data Analyst", location: "Lyon", status: "Angebot", statusTone: "indigo", activity: "Angebot diese Woche erhalten" },
        { company: "Mistral AI", role: "Growth Intern", location: "Paris", status: "Ausstehend", statusTone: "amber", activity: "Aktion erforderlich" },
      ],
      aiApplySuccess: "Deine Bewerbung wurde versendet!", aiGenerating: "Wird erstellt…",
    },
    es: {
      badge: "Descubre Hirly", title: "Tu búsqueda de empleo, siempre contigo.", titleMuted: "Solicita empleos más rápido y controla todo desde tu móvil.",
      subtitle: "La aplicación de Hirly pone toda tu búsqueda de empleo en tu bolsillo: encuentra puestos, genera candidaturas personalizadas y sigue cada oferta sin esfuerzo.",
      features: [
        { id: "personalization", title: "Personalización", lead: "Destaca con candidaturas a medida.", body: "Hirly genera un CV y una carta de presentación adaptados a cada oferta, puesto y empresa." },
        { id: "auto_apply", title: "Solicitud con IA", lead: "Solicita empleos con un solo gesto.", body: "Olvídate de los formularios interminables. Hirly prepara y envía tus candidaturas por ti para que ahorres horas cada semana." },
        { id: "tracking", title: "Seguimiento", lead: "Cada candidatura, seguida automáticamente.", body: "Hirly mantiene toda tu búsqueda organizada en un único panel sencillo." },
      ],
      highlights: [
        { id: "secure", title: "Seguridad desde el diseño", body: "Tus datos y candidaturas permanecen protegidos." },
        { id: "sync", title: "Sincronización en tiempo real", body: "Tus actualizaciones se sincronizan en todos tus dispositivos." },
        { id: "dashboard", title: "Panel unificado", body: "Ofertas, estados, correos y documentos en un solo lugar." },
        { id: "cover_letters", title: "Cartas con IA", body: "Cartas personalizadas generadas en segundos." },
        { id: "resume", title: "CV siempre actualizado", body: "Tu perfil se mantiene al día con tus habilidades y experiencia." },
        { id: "insights", title: "Insights de IA", body: "Descubre qué funciona y dónde recibes más respuestas." },
        { id: "experience", title: "Experiencia fluida", body: "Busca, solicita y realiza el seguimiento en un único flujo." },
        { id: "everywhere", title: "Contigo en todas partes", body: "Web y móvil: tu progreso permanece sincronizado." },
      ],
      trackerCards: [
        { company: "Doctolib", role: "Product Manager", location: "París", status: "Entrevista", statusTone: "purple", activity: "Entrevista programada para mañana" },
        { company: "L'Oréal", role: "Marketing Analyst", location: "Remoto", status: "Solicitud enviada", statusTone: "blue", activity: "Solicitud enviada hace 3 días" },
        { company: "BNP Paribas", role: "Data Analyst", location: "Lyon", status: "Oferta", statusTone: "indigo", activity: "Oferta recibida esta semana" },
        { company: "Mistral AI", role: "Growth Intern", location: "París", status: "Pendiente", statusTone: "amber", activity: "Acción requerida" },
      ],
      aiApplySuccess: "¡Tu candidatura se ha enviado!", aiGenerating: "Generando…",
    },
    it: {
      badge: "Scopri Hirly", title: "La tua ricerca di lavoro, sempre con te.", titleMuted: "Candidati più velocemente e tieni tutto sotto controllo dal tuo telefono.",
      subtitle: "L'app Hirly mette tutta la tua ricerca di lavoro in tasca: trova offerte, genera candidature su misura e monitora ogni posizione senza fatica.",
      features: [
        { id: "personalization", title: "Personalizzazione", lead: "Distinguiti con candidature su misura.", body: "Hirly genera un CV e una lettera di presentazione adatti a ogni offerta, ruolo e azienda." },
        { id: "auto_apply", title: "Candidatura con IA", lead: "Candidati con uno swipe.", body: "Niente più moduli infiniti. Hirly prepara e invia le tue candidature per te, facendoti risparmiare ore ogni settimana." },
        { id: "tracking", title: "Monitoraggio", lead: "Ogni candidatura, monitorata automaticamente.", body: "Hirly organizza tutta la tua ricerca di lavoro in un'unica dashboard semplice." },
      ],
      highlights: [
        { id: "secure", title: "Sicurezza integrata", body: "I tuoi dati e le tue candidature restano protetti." },
        { id: "sync", title: "Sincronizzazione in tempo reale", body: "I tuoi aggiornamenti si sincronizzano su tutti i dispositivi." },
        { id: "dashboard", title: "Dashboard unificata", body: "Offerte, stati, email e documenti in un unico posto." },
        { id: "cover_letters", title: "Lettere con IA", body: "Lettere personalizzate generate in pochi secondi." },
        { id: "resume", title: "CV sempre aggiornato", body: "Il tuo profilo resta allineato alle tue competenze ed esperienze." },
        { id: "insights", title: "Insight IA", body: "Scopri cosa funziona e dove ricevi più risposte." },
        { id: "experience", title: "Esperienza fluida", body: "Cerca, candidati e monitora in un unico flusso." },
        { id: "everywhere", title: "Sempre con te", body: "Web e mobile: i tuoi progressi restano sincronizzati." },
      ],
      trackerCards: [
        { company: "Doctolib", role: "Product Manager", location: "Parigi", status: "Colloquio", statusTone: "purple", activity: "Colloquio previsto domani" },
        { company: "L'Oréal", role: "Marketing Analyst", location: "Da remoto", status: "Candidatura inviata", statusTone: "blue", activity: "Candidatura inviata 3 giorni fa" },
        { company: "BNP Paribas", role: "Data Analyst", location: "Lione", status: "Offerta", statusTone: "indigo", activity: "Offerta ricevuta questa settimana" },
        { company: "Mistral AI", role: "Growth Intern", location: "Parigi", status: "In attesa", statusTone: "amber", activity: "Azione richiesta" },
      ],
      aiApplySuccess: "La tua candidatura è stata inviata!", aiGenerating: "Generazione in corso…",
    },
  };

  if (localizedCatalogs[locale]) return localizedCatalogs[locale];

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
