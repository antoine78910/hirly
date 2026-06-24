/** Content Bank Examples — French translations. */

import { frCaption, frHashtagLine } from "./trainingHashtags";
import {
  bulletList,
  examplesGrid,
  heading,
  infoScript,
  paragraph,
  sectionBlock,
  warningGuideline,
} from "./trainingDocBlocks";

function ex(label, url = "") {
  return url ? { label, url } : label;
}

export const CONTENT_BANK_FR = [
  sectionBlock({
    section_id: "sec_cb_websites",
    title: "3 sites à garder secret",
    content: [
      heading(1, "3 sites que tu devrais garder pour toi"),
      heading(3, "Exemples"),
      examplesGrid([
        ex("Version Anara / Turbo", "https://www.instagram.com/reels/DVfgvqZjVMj/"),
        ex(
          "Version Keep Up Tools",
          "https://www.tiktok.com/@keepuptools/video/7225134046781705478?_r=1&_t=ZP-95NfUynjgoo",
        ),
        ex(
          "Vidéo de Riyaj — 3M vues",
          "https://www.tiktok.com/@keepuptools/video/7225134046781705478?_r=1&_t=ZP-95NfUynjgoo",
        ),
        ex("Vidéo de Kayla — 107K vues", "https://www.instagram.com/reel/DYVHtyRxliQ/"),
        ex(
          "Vidéo de Cleo — 140K vues",
          "https://www.instagram.com/reel/DXLK4UDD_YE/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex("Vidéo de Michala — 116K vues", "https://www.instagram.com/reel/DYVHtyRxliQ/"),
        ex(
          "Vidéo de Karen — 115K vues",
          "https://www.instagram.com/reel/DYOe-zAy0Go/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
      ]),
      heading(3, "Consignes"),
      warningGuideline("Montre bien les vrais sites web dont tu parles dans la vidéo !"),
      heading(3, "Exemples de légendes"),
      paragraph(
        `Fini les trajets McDo pour rien à cause des machines à McFlurry en panne. Utilise un VPN et un bloqueur de pub sur ces sites de streaming 😭🙏 ${frHashtagLine("etudiant", "alternance", "stage", "travail", "emploi")}\nBloqueur de pub pour le streaming !! Sites : vidbox.cc, Hirly, bored.com ${frHashtagLine("emploi", "rechercheemploi", "tipsemploi", "cv", "carriere")}\nDes apps qu'on dirait illégales à connaître ${frHashtagLine("emploi", "tipsemploi", "conseilscarriere", "cv", "rechercheemploi")}`,
      ),
      heading(2, "Script principal"),
      infoScript(
        "Voici trois sites que tu devrais garder secret parce qu'ils sont juste trop bons. Ce site te donne accès à tous les services de streaming. Netflix, Disney+, Prime Video. Tu peux trouver et regarder n'importe quoi gratuitement. Le deuxième, c'est Hirly. Tu uploades ton CV une fois et il adapte ton CV et ta lettre de motivation pour chaque offre, et postule même directement sur les sites des entreprises. C'est dangereux — et si tu commençais vraiment à avoir des entretiens ? Et le dernier, c'est pour tous les gros mangeurs : ce site te montre quelles machines à glace McDonald's fonctionnent. Cherche ta localisation et tu peux vérifier le magasin exact. Sauvegarde cette vidéo pour toi et souviens-toi que ça vient de moi.",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "Il y a trois sites que tu devrais garder secret parce qu'ils sont juste trop bons. Ce site te donne accès à plein de services de streaming et tu peux littéralement regarder n'importe quoi gratuitement.\n\nLe deuxième, c'est Hirly. Tu uploades ton CV et tu swipes à droite sur les jobs auxquels tu veux postuler. En plus, il envoie une lettre de motivation et un CV adaptés directement aux entreprises.\n\nEt le suivant, c'est Bored.com, qui regroupe plein de sites fun, intéressants et cool à découvrir — et ils sont interactifs.",
      ),
      heading(2, "Variation 2"),
      infoScript(
        "3 apps puissantes qu'on dirait illégales à connaître.\nNuméro 1 : cette appli. Tu pourras récupérer les mots de passe Wi-Fi de ton quartier.\n\nNuméro 2 : cette appli. Tu pourras télécharger ce que tu veux juste en tapant le nom.\n\nNuméro 3 : cette appli (affiche le nom Hirly à l'écran pour la comp complète). Tu uploades ton CV une fois et il adapte ton CV et ta lettre pour chaque offre. Il postule même en auto directement sur les sites des entreprises.",
      ),
      heading(2, "Variation 3"),
      infoScript(
        "Des sites qu'on dirait illégaux à connaître et dont personne ne parle. Si tu vas sur ce site, tu peux télécharger n'importe quelle app payante gratuitement. CapCut Pro, jeux payants, Spotify Premium. Même des abos gratuits sur des services de streaming. Il y a des apps pour tous tes besoins sur ce site.\n\nEnsuite, celui-ci pour la recherche d'emploi. Sur Hirly, tu uploades ton CV une fois et il adapte ton CV et ta lettre pour chaque offre. Il postule même en auto sur les sites des entreprises. J'ai commencé à l'utiliser et maintenant j'ai vraiment des entretiens qui s'enchaînent, c'est un peu fou.\n\nEnfin, pour tous les sportifs : sur ce site, tu cliques sur n'importe quel groupe musculaire. Si tu veux des gros fessiers comme moi, tu cliques dessus et il te dit exactement quels entraînements faire. Like et abonne-toi pour plus. Cheers.",
      ),
      heading(2, "Variation 4"),
      infoScript(
        "Voici trois sites que les écoles ne veulent pas que tu connaisses. Ce site te donne accès à tous les streamings — Netflix, Disney+, Prime Video, et même Crunchyroll. Ils ont des serveurs en plusieurs langues et la qualité vidéo est vraiment top. Fais quand même attention en cours.\n\nLe deuxième, c'est Hirly. Tu uploades ton CV et tu swipes à droite sur les stages auxquels tu veux postuler. En plus, il envoie une lettre et un CV adaptés directement aux entreprises.\n\nEt le dernier, pour ceux qui font de la chimie : tu entres n'importe quelle équation chimique et il la balance pour toi. Comme ça tu visualises et tu vérifies ton travail. Espérons que ton prof de chimie garde son job après ça. Sauvegarde pour plus tard — qu'on devienne tous des armes académiques.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_gbb",
    title: "Bien. Mieux. Le top.",
    badge: "Top format",
    content: [
      heading(1, "Bien. Mieux. Le top."),
      heading(3, "Exemples"),
      examplesGrid([
        ex(
          "Vidéo de Maryam — 1,4M vues",
          "https://www.tiktok.com/@that.corporate.blackgirl/video/7629405559799893268",
        ),
        ex(
          "Vidéo de Cleo — 2,4M vues",
          "https://www.instagram.com/reel/DXF6h7Tj4bO/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex("Vidéo d'Ava — 3,2M vues", "https://www.instagram.com/reels/DXYCByYCueO/"),
        ex("Vidéo d'Eylul — 500K vues", "https://www.instagram.com/reel/DYOD3hThFov/"),
        ex(
          "Vidéo de John — 100K vues",
          "https://www.tiktok.com/@johnseekingjob/video/7631983608885939486",
        ),
      ]),
      heading(3, "Consignes"),
      warningGuideline(
        "Tiens/fais autre chose en parlant. Pointe les catégories (Bien, Mieux, Le top) quand tu les abordes.",
      ),
      heading(3, "Légendes vidéo"),
      paragraph(
        frCaption(
          "Bien, mieux, le top : édition candidature !",
          "emploi",
          "rechercheemploi",
          "linkedin",
          "indeed",
          "conseilscarriere",
        ),
      ),
      heading(2, "Script principal"),
      infoScript(
        "Bien. Mieux. Le top. Édition candidature.\n\nBien. LinkedIn et Indeed.\nTes plateformes classiques. Plein d'offres, mais tu es en concurrence avec des centaines de candidats — souvent c'est hit or miss.\n\nMieux. Welcome to the Jungle / France Travail.\nPlus ciblé pour le marché français. Stages, alternances et premiers jobs, mais tu dois tout postuler toi-même.\n\nLe top. Hirly. Tu swipes à droite sur les jobs que tu veux et ça postule en auto à des centaines d'offres sans que tu fasses quoi que ce soit. CV et lettre adaptés par offre, soumis directement sur le site de l'entreprise.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_linkedin",
    title: "Rappel LinkedIn",
    badge: "Top format",
    content: [
      heading(1, "Petit rappel pour ceux qui utilisent encore LinkedIn"),
      heading(3, "Exemples"),
      examplesGrid([
        ex(
          "Vidéo de Rene — 100K vues",
          "https://www.tiktok.com/@careerwith.rene/video/7560449753025219862?is_from_webapp=1&sender_device=pc",
        ),
        ex(
          "Vidéo de Sarah — 55K vues",
          "https://www.tiktok.com/@careerwithsarah/video/7575267000725900599?lang=en",
        ),
        ex("Vidéo de Riyaj — 2,3M vues", "https://www.facebook.com/reel/985734247469241"),
        ex(
          "Vidéo de Tony — 1,3M vues",
          "https://www.tiktok.com/@tony_w21/video/7606508525233147157?lang=en-GB",
        ),
        ex("Exemple Heynavii.ai", "https://www.instagram.com/reels/DTwS6RTCa3A/"),
        ex("Variation différente", "https://www.instagram.com/p/DTRe98gkeG-/"),
      ]),
      paragraph(
        "Reste simple et direct, 15–20 secondes, haute énergie et rythme de parole rapide.",
      ),
      heading(3, "Consignes"),
      warningGuideline(
        'LinkedIn requis. Quand tu montres l\'app, affiche le mot « Hirly » en texte dans la vidéo → « Apparemment il y a cette app Hirly qui te permet de… »\nBouge-toi dans les 3 premières secondes et flip la caméra pour montrer LinkedIn → le mouvement accroche l\'œil.',
      ),
      heading(3, "Légendes"),
      paragraph(
        `Accroche texte dans la vidéo :\n• Petit rappel pour ceux qui utilisent encore LinkedIn 🤨‼️\n• Chercher un emploi en 2026, c'est un rituel d'humiliation\n\nLégende hors vidéo :\nSi tu utilises seulement LinkedIn et Indeed, tu es en concurrence avec des centaines de candidats sur les mêmes offres.\n${frHashtagLine("rechercheemploi", "tipsemploi", "emploi", "cv", "carriere", "emploifrance")}`,
      ),
      heading(2, "Script principal"),
      infoScript(
        "Petit rappel : chercher un job en 2026… [Montre un scroll de candidatures sur LinkedIn] …c'est littéralement un rituel d'humiliation. [Reviens face caméra] Parce que regarde ce que mon pote vient de me montrer [Flip vers Hirly] Apparemment il y a cette app Hirly où tu uploades juste ton CV. Elle te montre plein de jobs, et à chaque swipe à droite, l'IA postule sur le site de l'entreprise avec un CV et une lettre personnalisés pour le poste. Elle pose même quelques questions rapides spécifiques au job pour que chaque candidature soit vraiment adaptée. Fou…",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "Petit rappel… [Montre un scroll de candidatures sur LinkedIn] ÇA c'est littéralement une perte de temps totale maintenant. [Reviens face caméra] Parce que regarde ce que mon pote vient de me montrer. [Flip vers Hirly] Apparemment il y a cette app Hirly où tu uploades juste ton CV. Elle te montre plein de jobs et à chaque swipe à droite, l'IA postule sur le site de l'entreprise avec un CV et une lettre personnalisés.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_100k",
    title: "Plateformes 50K€",
    content: [
      heading(1, "Les plateformes qui m'ont valu un salaire à 50K€"),
      heading(3, "Exemples"),
      examplesGrid([
        ex("Vidéo de Riyaj — 142K vues", "https://www.facebook.com/reel/2679321229131031"),
      ]),
      heading(3, "Consignes"),
      warningGuideline(
        "Positionne-toi en expert. Utilise un accessoire visuel — verser une boisson, préparer un matcha.",
      ),
      heading(3, "Légende"),
      paragraph(
        `Accroche texte : Les plateformes qui m'ont valu un salaire à 50K€\nLégende hors vidéo : Teste celles-ci ${frHashtagLine("emploi", "rechercheemploi", "carriere", "tipsemploi", "emploifrance")}`,
      ),
      heading(2, "Script principal"),
      infoScript(
        "Je vais te donner tous les sites que mes potes et moi avons utilisés pour décrocher un bon salaire en France — et non, t'as pas besoin de LinkedIn, t'as pas besoin d'Indeed.\n\nTu dois juste comprendre le concept de levier.\n\nVoici trois sites que tu peux utiliser.\n\nPerso j'adore le deuxième.\n\nLe premier, c'est Google Careers. Tu cherches un poste et Google sort toutes ces offres de partout sur internet. Filtre par lieu, salaire, et même télétravail.\n\nLe deuxième, c'est Hirly. Tu uploades ton CV, tu regardes les jobs, et à chaque clic sur postuler, l'IA postule pour toi sur le site de l'entreprise. C'est aussi simple que ça. Chaque candidature a une lettre et un CV personnalisés.\n\nLe troisième, c'est Welcome to the Jungle. Des milliers d'opportunités pour étudiants et jeunes diplômés que la plupart des gens ignorent en France.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_website_made",
    title: "J'ai créé un site appelé",
    content: [
      heading(1, "J'ai créé un site appelé…"),
      heading(3, "Exemples"),
      examplesGrid([
        ex("Vidéo de Riyaj — 730K vues (Prep AI)", "https://www.tiktok.com/t/ZTBMhK1T1/"),
        ex(
          "Vidéo de Simon — 7K vues",
          "https://www.instagram.com/reel/DYyYzNJsn6h/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
      ]),
      heading(3, "Consignes"),
      warningGuideline(
        'Fais une petite pause avant de dire « point com » pour l\'emphase. Voix PLATE/MONOTONE en disant « point com ».',
      ),
      heading(3, "Légende"),
      paragraph(
        `Accroche texte : J'ai créé un site appelé…\nLégende hors vidéo : regarde si t'as pas encore d'emploi de prévu 😳 ${frHashtagLine("recrutement", "stage", "rechercheemploi", "tipsemploi", "emploi")}`,
      ),
      heading(2, "Script principal"),
      infoScript(
        "J'ai créé un site appelé… [Nouvel angle caméra, plus proche, en contre-plongée]\nJe suis bientôt diplômé et je dois postuler à genre mille jobs mais j'ai même pas commencé point com.\nC'est un site pour ceux qui veulent postuler à plein de jobs tout en économisant un max de temps.\n[Tuto Hirly]\nTu vas sur Hirly et tu uploades ton CV. Ensuite tu vas sur postuler et tu swipes à droite pour candidater. Si tu veux pas le job, swipe à gauche. L'IA postule automatiquement pour toi. Tu peux même suivre tes candidatures passées.\n[Retour face caméra]\nTu peux probablement envoyer genre 100 candidatures dans la prochaine demi-heure.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_marry",
    title: "Trend épouser/embrasser",
    content: [
      heading(1, "Vidéo trend : Je vais épouser/embrasser la personne qui m'a montré ça"),
      heading(3, "Accroche texte dans la vidéo"),
      bulletList([
        "Je vais épouser la personne qui m'a montré ça",
        "Je vais embrasser la personne qui m'a montré ça",
        "Je vais épouser l'employé Google qui m'a montré ça 🤯🤯",
        "Celui/celle qui m'a montré ça va se faire sucer l'orteil 🤯🤯",
      ]),
      heading(3, "Légende hors vidéo"),
      bulletList([
        `Je ne postulerai plus jamais manuellement ${frHashtagLine("recrutement", "alternance", "rechercheemploi", "stage", "emploi")}`,
        `J'ai peur que ça ait changé ma vie 😭 ${frHashtagLine("rechercheemploi", "recrutement", "alternance", "stage", "carriere")}`,
      ]),
      heading(2, "Script principal"),
      infoScript(
        '[PREMIER CLIP] Air choqué/main sur la bouche, flip l\'écran vers Hirly\n[CLIP SUIVANT] Texte à l\'écran (fais apparaître ces textes en montrant l\'UI) :\n« trouve le job que tu veux »\n« upload ton CV sur Hirly »\n« swipe à droite sur les jobs »\n« l\'IA postule en auto avec un CV/lettre adaptés pour chaque offre »\n« directement sur le site de l\'entreprise »',
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_ungatekeep",
    title: "3 sites pour un bon salaire",
    content: [
      heading(1, "Je dévoile les 3 sites pour un bon salaire cet été"),
      heading(3, "Exemples"),
      examplesGrid([
        ex(
          "Vidéo de Jhyrom — 600K vues",
          "https://www.instagram.com/reel/DWDBUe6DHWd/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex(
          "Vidéo de Kate — 43K vues",
          "https://www.instagram.com/reel/DWl1SyRjSL8/?igsh=Mzc3ZTVlOWMwZA==",
        ),
        ex(
          "Vidéo d'Ava — 18K vues",
          "https://www.instagram.com/reel/DX8SwqIKl2v/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex(
          "Vidéo de Maryam — 25K vues",
          "https://www.tiktok.com/@that.corporate.blackgirl/video/7624707570053238036",
        ),
      ]),
      heading(3, "Légendes"),
      paragraph(
        `Accroche texte :\n• Je dévoile les 3 sites pour un bon salaire cet été\n• Je dévoile les 3 sites qui m'ont valu un stage été 2026 à 25€/h\n\nLégende hors vidéo :\nTop 3 sites pour un stage été 2026 ${frHashtagLine("stage", "alternance", "emploi", "rechercheemploi", "tipsemploi", "carriere")}`,
      ),
      heading(2, "Script principal"),
      infoScript(
        "Apparais devant une grande entreprise (sinon filme-toi en marchant/posant), avec l'accroche texte exactement comme dans la vidéo de référence.\n\nJe dévoile les 3 sites qui m'ont valu un stage été 2026 à 25€/h.\n\nMontre ton écran laptop, puis scroll dans les repos jobs GitHub.\n1. Hiring Cafe — Montre ton écran, puis scroll sur Hiring Cafe.\n2. Montre Hirly à l'écran, active ton CV généré par IA, et swipe à droite pour postuler en auto.\n3. Google Jobs — montre ton écran laptop, puis scroll.",
      ),
      heading(3, "Consignes"),
      warningGuideline(
        "Options d'audio trending pour la vidéo :\nhttps://www.instagram.com/reels/audio/26447457621525979/\nOU\nhttps://www.instagram.com/reels/audio/2267773183744321/",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_hired",
    title: "Embauché vs au chômage",
    content: [
      heading(1, "Embauché vs au chômage"),
      heading(3, "Exemples"),
      examplesGrid([
        ex(
          "Vidéo de Cleo — 107K vues",
          "https://www.instagram.com/reel/DX-nfQbP3Aw/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex(
          "Vidéo de Cleo — 116K vues",
          "https://www.instagram.com/reel/DX5V5dOvtrW/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
      ]),
      heading(3, "Consignes"),
      warningGuideline(
        "Tutoriel montage\nAssets vidéo\nNOTE : Tenue pro/business pour le persona embauché, tenue confort/casual pour le persona au chômage.",
      ),
      heading(3, "Légende"),
      paragraph(
        `Exemple légende hors vidéo : Surtout dans ce marché, postule plus malin, pas plus dur ${frHashtagLine("rechercheemploi", "emploi", "travail", "carriere", "emploifrance")}`,
      ),
      heading(2, "Script principal"),
      paragraph("C = Chômage  |  E = Embauché"),
      infoScript(
        "C : Je répète mes réponses dans ma tête 10 minutes avant l'entretien.\nE : Je m'enregistre en mock interview pour vérifier langage corporel, ton et rythme.\n\nC : Je fais de longues histoires quand on me parle de mon expérience.\nE : J'utilise la méthode STAR pour rester concis.\n\nC : Je passe trois heures par jour à postuler manuellement.\nE : Je swipe pour postuler en auto à des centaines d'offres sur Hirly.",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "C : Je me fiche de l'interviewer.\nE : J'ai recherché les interviewers à l'avance pour comprendre le rôle dans l'entreprise.\n\nC : J'utilise le même CV et la même lettre partout.\nE : J'utilise Hirly pour générer des lettres et CV adaptés à chaque offre.\n\nC : Je passe trois heures par jour à postuler.\nE : J'utilise Hirly pour postuler en auto à des centaines d'offres en quelques minutes.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_secret_job_2026",
    title: "Moyens secrets de trouver un job en 2026",
    content: [
      heading(1, "Moyens secrets de trouver un job en 2026"),
      heading(3, "Exemples"),
      examplesGrid([
        ex(
          "Vidéo de Maryam — 164K vues",
          "https://www.tiktok.com/@that.corporate.blackgirl/video/7608782339253996820",
        ),
        ex("Vidéo de Nicole J — 45K vues", "https://www.instagram.com/reels/DVJpW3FiVFz/"),
        ex("Vidéo originale", "https://www.instagram.com/reels/DU7KlUREViT/"),
      ]),
      heading(3, "Consignes"),
      warningGuideline(
        "Il faut un laptop ou un deuxième téléphone pour filmer les sites d'emploi.",
      ),
      heading(3, "Légende"),
      paragraph(
        `Accroche texte :\nMoyens secrets de trouver un job en 2026\n\nLégende hors vidéo :\n- Tu dois connaître ces deux sites si tu veux vraiment des entretiens.\n- Si tu postules uniquement sur LinkedIn et Indeed, tu es en concurrence avec des centaines de candidats sur les mêmes offres.\n${frHashtagLine("rechercheemploi", "tipsemploi", "teletravail", "candidature", "carriere")}`,
      ),
      heading(2, "Script principal"),
      infoScript(
        "Personne n'embauche en ce moment. Hmm. C'est peut-être juste toi.\nEt peut-être que tu cherches au mauvais endroit.\n\nSi tu ne connais pas ces deux sites, laisse-moi te mettre au courant.\nL'un s'appelle Welcome to the Jungle — des milliers d'offres en France que la plupart des gens ignorent.\n\nL'autre s'appelle Hirly.\nLui, il postule en auto sur le site de l'entreprise avec une lettre et un CV adaptés à chaque offre.\n\nDis-moi si quelqu'un finit par l'utiliser.",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "Personne n'embauche en ce moment ? Hmm. C'est peut-être juste toi.\nEt peut-être que tu cherches au mauvais endroit.\n\nSi tu ne connais pas ces deux sites, laisse-moi te mettre au courant.\nL'un s'appelle Google Jobs — tu cherches un poste sur Google et ça sort les offres de partout sur internet. Tu peux filtrer par lieu, salaire, et même télétravail.\n\nL'autre s'appelle Hirly. Lui, il postule en auto sur le site de l'entreprise avec une lettre et un CV adaptés à chaque offre.\n\nDis-moi si quelqu'un finit par l'utiliser 👀",
      ),
      heading(2, "Variation 2"),
      infoScript(
        "Personne n'embauche ? C'est peut-être juste toi.\nPeut-être que tu cherches au mauvais endroit.\n\nSi tu ne connais pas ces deux sites, laisse-moi te mettre au courant.\nL'un s'appelle France Travail, avec des milliers d'opportunités que la plupart des gens passent à côté.\n\nEt l'autre ?\nC'est Hirly. Au lieu de passer des heures à postuler, il postule en auto sur le site de l'entreprise pour toi avec un CV et une lettre adaptés. Tu règles tes préférences, et il fait le gros du travail.\n\nSi tu en as marre de remplir la même candidature encore et encore, c'est peut-être la solution.\n\nDis-moi si l'un de vous finit par l'utiliser.",
      ),
    ],
  }),
];
