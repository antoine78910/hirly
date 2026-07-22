export function getLandingReviewsCopy(lang) {
  const locale = normalizeLandingReviewsLocale(lang);

  if (locale === "fr") {
    return {
      badge: "Vrais avis. Vraies personnes.",
      title: "De vrais résultats, de vrais candidats.",
      titleAccent: "Ils ont trouvé plus vite avec Hirly.",
      subtitle:
        "Ce que disent les candidats qui utilisent Hirly — sans filtre, juste des retours honnêtes.",
    };
  }
  if (locale === "de") return getGermanReviewsCopy();
  if (locale === "es") return getSpanishReviewsCopy();
  if (locale === "it") return getItalianReviewsCopy();
  return {
    badge: "Real feedback. Real people.",
    title: "Real results from real candidates.",
    titleAccent: "They found jobs faster with Hirly.",
    subtitle: "What candidates are saying about Hirly — no filters, just real wins.",
  };
}

export function getLandingReviewColumns(lang) {
  const locale = normalizeLandingReviewsLocale(lang);

  if (locale === "fr") return getFrenchReviewColumns();
  if (locale === "de") return getGermanReviewColumns();
  if (locale === "es") return getSpanishReviewColumns();
  if (locale === "it") return getItalianReviewColumns();
  return getEnglishReviewColumns();
}

export function getLandingReviewsAll(lang) {
  const [leftColumn, rightColumn] = getLandingReviewColumns(lang);
  return [...leftColumn, ...rightColumn];
}

function normalizeLandingReviewsLocale(lang) {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .split("-")[0];
}

function getGermanReviewsCopy() {
  return {
    badge: "Echte Bewertungen. Echte Menschen.",
    title: "Echte Ergebnisse von echten Bewerber:innen.",
    titleAccent: "Mit Hirly haben sie schneller einen Job gefunden.",
    subtitle:
      "Das sagen Bewerber:innen über Hirly — ehrlich, ungefiltert und aus eigener Erfahrung.",
  };
}

function getSpanishReviewsCopy() {
  return {
    badge: "Opiniones reales. Personas reales.",
    title: "Resultados reales de candidatos reales.",
    titleAccent: "Encontraron trabajo más rápido con Hirly.",
    subtitle: "Lo que cuentan los candidatos que usan Hirly: opiniones sinceras y sin filtros.",
  };
}

function getItalianReviewsCopy() {
  return {
    badge: "Recensioni vere. Persone vere.",
    title: "Risultati veri da candidati veri.",
    titleAccent: "Con Hirly hanno trovato lavoro più velocemente.",
    subtitle: "Cosa dicono i candidati che usano Hirly: esperienze sincere, senza filtri.",
  };
}

function getFrenchReviewColumns() {
  return [
    [
      {
        id: "thomas",
        name: "Thomas W.",
        subline: "Plusieurs entretiens en quelques jours",
        quote:
          "Je n'avais jamais décroché d'entretiens aussi vite. Je ne sais pas si c'est la chance, mais franchement, ça marche.",
      },
      {
        id: "verified",
        name: "Utilisateur vérifié",
        subline: "Avis 5 étoiles",
        quote:
          "Rien ne vaut Hirly. J'ai entre 5 et 10 entretiens par semaine. C'est devenu mon quotidien.",
      },
      {
        id: "karim",
        name: "Karim J.",
        subline: "Plus de 5 entretiens",
        quote: "Super appli : j'ai déjà décroché plus de 5 entretiens grâce à elle.",
      },
      {
        id: "lea",
        name: "Léa M.",
        subline: "Étudiante en école de commerce",
        quote:
          "L'interface est vraiment l'une des plus soignées que j'ai vues. On sent qu'ils pensent vraiment aux étudiants.",
      },
      {
        id: "nicolas",
        name: "Nicolas S.",
        subline: "Plus de 40 candidatures envoyées",
        quote: "Hirly change complètement la façon de chercher un emploi.",
      },
      {
        id: "sarah",
        name: "Sarah B.",
        subline: "En recherche de CDI",
        quote:
          "Remplir son profil une seule fois et swiper sur des offres pertinentes, ça change vraiment la donne.",
      },
      {
        id: "hugo",
        name: "Hugo S.",
        subline: "Designer",
        quote:
          "Une plateforme bienveillante et efficace. Un vrai soulagement quand on peine à trouver un emploi.",
      },
    ],
    [
      {
        id: "antoine",
        name: "Antoine B.",
        subline: "CDI dans une grande banque",
        quote:
          "Avec Hirly, j'ai eu plus de 10 entretiens et décroché un CDI dans une grande banque. J'ai déjà recommandé l'appli à 7 personnes.",
      },
      {
        id: "camille",
        name: "Camille R.",
        subline: "Alternance dans un grand groupe",
        quote:
          "Postuler offre par offre ne donnait plus rien. Hirly m'a redonné confiance dans ma recherche.",
      },
      {
        id: "julie",
        name: "Julie T.",
        subline: "CDI en marketing",
        quote:
          "J'ai accepté une offre dans une entreprise où j'avais postulé via Hirly. Le processus a été beaucoup plus simple.",
      },
      {
        id: "marc",
        name: "Marc D.",
        subline: "Responsable RH",
        quote:
          "En tant que RH, je conseille toujours d'adapter son CV. Cette appli comble vraiment ce manque. Les résultats se voient.",
      },
      {
        id: "emma",
        name: "Emma L.",
        subline: "Entretiens chez plusieurs grands comptes",
        quote:
          "Je suis bluffée par le nombre d'entretiens depuis que j'utilise Hirly. Des entreprises que je n'aurais jamais trouvées seule.",
      },
      {
        id: "david",
        name: "David P.",
        subline: "Entretien dans la tech",
        quote:
          "Swiper au lieu de remplir des formulaires sans fin, ça me fait gagner un temps fou.",
      },
      {
        id: "ines",
        name: "Inès V.",
        subline: "Dernière étape dans un grand groupe",
        quote: "La recherche d'emploi, c'est épuisant. Hirly enlève une grosse partie du stress.",
      },
    ],
  ];
}

function getGermanReviewColumns() {
  return getEnglishReviewColumnsWithVerifiedLabel("Verifizierte:r Nutzer:in");
}

function getSpanishReviewColumns() {
  return getEnglishReviewColumnsWithVerifiedLabel("Usuario verificado");
}

function getItalianReviewColumns() {
  return getEnglishReviewColumnsWithVerifiedLabel("Utente verificato");
}

function getEnglishReviewColumnsWithVerifiedLabel(verifiedUserLabel) {
  return getEnglishReviewColumns().map((column) =>
    column.map((review) =>
      review.id === "verified" ? { ...review, name: verifiedUserLabel } : review,
    ),
  );
}

function getEnglishReviewColumns() {
  return [
    [
      {
        id: "tony",
        name: "Tony W.",
        subline: "Multiple interviews in days",
        quote:
          "I've never gotten interviews this fast before. Idk if it's luck, but it's definitely working.",
      },
      {
        id: "verified",
        name: "Verified user",
        subline: "5★ review",
        quote:
          "Nothing comes close to Hirly. I'm landing 5 to 10 interviews per week. That's become the norm.",
      },
      {
        id: "karl",
        name: "Karl J.",
        subline: "5+ interviews",
        quote: "Your app is super cool and has already netted me 5+ interviews.",
      },
      {
        id: "kevin-z",
        name: "Kevin Z.",
        subline: "Business school student",
        quote:
          "The UI is genuinely one of the cleanest I've seen. They're building something meaningful for students like me.",
      },
      {
        id: "kevin-s",
        name: "Kevin S.",
        subline: "40+ applications sent",
        quote: "Your app is wonderful. It's totally changing the job hunt game.",
      },
      {
        id: "ashay",
        name: "Ashay M.",
        subline: "Hirly user",
        quote:
          "Filling out my profile once and swiping through relevant postings is a game changer.",
      },
      {
        id: "hugo",
        name: "Hugo S.",
        subline: "Designer",
        quote:
          "A platform that feels supportive and intentional. A true light at the end of the tunnel for everyone struggling to find a job.",
      },
    ],
    [
      {
        id: "anteneh",
        name: "Anteneh",
        subline: "Hired at a major bank",
        quote:
          "Through Hirly, I had over 10 interviews and landed a permanent role at a major bank. I've already referred 7+ people.",
      },
      {
        id: "augustine",
        name: "Augustine",
        subline: "Hired at Barclays",
        quote:
          "Applying to jobs one by one simply wasn't working. Hirly has changed my outlook on future opportunities.",
      },
      {
        id: "michelle",
        name: "Michelle I.",
        subline: "Hired at Capital One",
        quote:
          "I accepted the offer from Capital One that I interviewed with through Hirly. Using Hirly made the process so much easier.",
      },
      {
        id: "tani",
        name: "Tani M.",
        subline: "HR leader, offer pending",
        quote:
          "As an HR leader, I advise candidates to tailor every resume. This app closed that execution gap. The result was measurable.",
      },
      {
        id: "brooke",
        name: "Brooke D.",
        subline: "Interviews at Capital One, Condé Nast, T-Mobile",
        quote:
          "I'm shocked by how many interviews I've gotten since joining. Multiple companies I wouldn't have discovered if it weren't for Hirly.",
      },
      {
        id: "mitraj",
        name: "Mitraj P.",
        subline: "Interview at NVIDIA",
        quote:
          "Applying with a swipe instead of repetitive application forms saves me a significant amount of time.",
      },
      {
        id: "pooja",
        name: "Pooja V.",
        subline: "Final round at S&P Global",
        quote:
          "The job application process is grueling, and Hirly simplifies so much of the stress that comes with it.",
      },
    ],
  ];
}
