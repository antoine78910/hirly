import { motion } from "framer-motion";
import { Bell, Briefcase, Phone, ShieldCheck, Zap } from "lucide-react";
import { ob } from "./onboardingTheme";

export function getContactPhoneCopy(lang = "fr") {
  if (lang === "fr") {
    return {
      title: "Votre numéro pour postuler",
      subtitle:
        "Certaines entreprises exigent un numéro pour accepter votre candidature. Ajoutez-le une fois — nous l'inclurons sur chaque dossier pour qu'elles puissent aussi vous recontacter rapidement.",
      label: "Votre numéro mobile",
      placeholder: "6 12 34 56 78",
      prefix: "+33",
      benefits: [
        { Icon: Briefcase, text: "Requis par de nombreuses entreprises pour postuler" },
        { Icon: Zap, text: "Plus facile pour les recruteurs de vous rappeler" },
        { Icon: ShieldCheck, text: "Uniquement pour vos candidatures" },
      ],
      notificationTitle: "Entretien proposé",
      notificationBody: "Une entreprise souhaite vous joindre",
      notificationTime: "À l'instant",
      badge: "Souvent requis",
    };
  }

  return {
    title: "Your number to apply",
    subtitle:
      "Some companies require a phone number before they accept your application. Add it once — we'll include it on every package so they can reach you back quickly too.",
    label: "Your mobile number",
    placeholder: "555 123 4567",
    prefix: "+1",
    benefits: [
      { Icon: Briefcase, text: "Required by many companies to apply" },
      { Icon: Zap, text: "Makes it easier for recruiters to call you back" },
      { Icon: ShieldCheck, text: "Only used for your applications" },
    ],
    notificationTitle: "Interview invite",
    notificationBody: "A company wants to reach you",
    notificationTime: "Just now",
    badge: "Often required",
  };
}

const cardReveal = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

const benefitReveal = {
  hidden: { opacity: 0, x: -8 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.18 + i * 0.08, duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  }),
};

export default function OnboardingContactPhoneStep({
  lang,
  phonePrefix,
  phoneLocal,
  onPrefixChange,
  onPhoneChange,
}) {
  const copy = getContactPhoneCopy(lang);

  return (
    <div className={`${ob.stepBodyOptions} space-y-4 py-1 sm:space-y-5`}>
      <motion.div
        variants={cardReveal}
        initial="hidden"
        animate="visible"
        className="relative overflow-hidden rounded-3xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 shadow-[0_20px_50px_-24px_rgba(124,58,237,0.45)] sm:p-5"
        data-testid="onboarding-phone-hero"
      >
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-violet-300/25 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-sky-300/20 blur-2xl" />

        <div className="relative flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-linkedin shadow-sm ring-1 ring-violet-100">
            <Phone className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-600">
              {copy.badge}
            </span>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              className="mt-3 rounded-2xl border border-white/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm"
            >
              <div className="flex items-start gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-linkedin/10 text-linkedin">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-zinc-900">{copy.notificationTitle}</p>
                    <span className="shrink-0 text-[10px] font-medium text-zinc-400">{copy.notificationTime}</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-zinc-600">{copy.notificationBody}</p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.35 }}
        className="w-full"
      >
        <label htmlFor="onboarding-phone-input" className="mb-2 block text-sm font-semibold text-zinc-800">
          {copy.label}
        </label>
        <div className="flex overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm focus-within:border-linkedin focus-within:ring-2 focus-within:ring-linkedin/20">
          <input
            type="text"
            inputMode="tel"
            value={phonePrefix}
            onChange={(e) => onPrefixChange(e.target.value.replace(/[^\d+]/g, "").slice(0, 5))}
            className="w-[4.25rem] shrink-0 border-r border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 focus:outline-none sm:w-[4.75rem]"
            aria-label="Country code"
            data-testid="onboarding-phone-prefix"
          />
          <input
            id="onboarding-phone-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={phoneLocal}
            onChange={(e) => onPhoneChange(e.target.value.replace(/[^\d\s.-]/g, "").slice(0, 20))}
            placeholder={copy.placeholder}
            className="min-w-0 flex-1 px-4 py-3.5 text-base font-medium text-zinc-900 placeholder:text-zinc-300 focus:outline-none sm:py-4"
            data-testid="onboarding-phone-input"
          />
        </div>
      </motion.div>

      <ul className="space-y-2.5">
        {copy.benefits.map(({ Icon, text }, index) => (
          <motion.li
            key={text}
            custom={index}
            variants={benefitReveal}
            initial="hidden"
            animate="visible"
            className="flex items-center gap-2.5 rounded-xl border border-zinc-100 bg-white/80 px-3 py-2.5 text-sm text-zinc-700 shadow-sm"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-linkedin/10 text-linkedin">
              <Icon className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="font-medium leading-snug">{text}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
