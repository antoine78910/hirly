import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, MessageCircle, AlarmClock, Search, Rocket, Send } from "lucide-react";
import { BRAND } from "../lib/brand";
import { api } from "../lib/api";
import { sel } from "../lib/selectionTheme";
import {
  countryFlag,
  filterPhoneCountries,
  getDefaultPhoneCountryIso2,
  getDefaultPhonePrefix,
} from "../lib/phoneCountryCodes";

const STEPS = [
  "social",
  "company",
  "name",
  "whatsapp",
  "whatsappConsent",
  "email",
  "location",
  "final",
];

const FEATURED_COUNTRIES = [
  { iso2: "FR", label: "France" },
  { iso2: "BE", label: "Belgique" },
  { iso2: "CH", label: "Suisse" },
  { iso2: "CA", label: "Canada" },
  { iso2: "MA", label: "Maroc" },
  { iso2: "LU", label: "Luxembourg" },
];

function Field({ label, children }) {
  return (
    <div className="mb-5">
      <p className="text-sm font-semibold text-zinc-800 mb-2">{label}</p>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-linkedin/30 focus:border-linkedin";

const continueButtonClass =
  "w-full rounded-full gradient-linkedin text-white font-bold py-3.5 text-base disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:opacity-90 transition-opacity shadow-[0_12px_40px_-12px_rgba(124,58,237,0.45)]";

export default function CreatorApply() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    tiktok: "",
    instagram: "",
    hasCompany: "",
    firstName: "",
    lastName: "",
    whatsappCountry: getDefaultPhoneCountryIso2("fr"),
    whatsappDial: getDefaultPhonePrefix("fr"),
    whatsappNumber: "",
    whatsappConsent: false,
    email: "",
    country: "",
    countryOther: "",
    referredBy: "",
    message: "",
  });

  const phoneCountries = useMemo(() => filterPhoneCountries("", "fr"), []);
  const step = STEPS[stepIndex];
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const canContinue = () => {
    switch (step) {
      case "social":
        return form.tiktok.trim().length > 0 || form.instagram.trim().length > 0;
      case "company":
        return Boolean(form.hasCompany);
      case "name":
        return form.firstName.trim().length > 0 && form.lastName.trim().length > 0;
      case "whatsapp":
        return form.whatsappNumber.trim().length >= 4;
      case "whatsappConsent":
        return form.whatsappConsent;
      case "email":
        return /\S+@\S+\.\S+/.test(form.email.trim());
      case "location":
        return (
          Boolean(form.country) && (form.country !== "other" || form.countryOther.trim().length > 0)
        );
      default:
        return true;
    }
  };

  const goBack = () => {
    if (stepIndex === 0) {
      navigate("/creators");
      return;
    }
    setStepIndex((i) => i - 1);
  };

  const goNext = () => {
    if (!canContinue()) return;
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post("/creators/apply", {
        email: form.email.trim(),
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        tiktok_handle: form.tiktok.trim() || null,
        instagram_handle: form.instagram.trim() || null,
        has_company: form.hasCompany || null,
        whatsapp_country: form.whatsappCountry || null,
        whatsapp_number: form.whatsappNumber
          ? `${form.whatsappDial} ${form.whatsappNumber}`.trim()
          : null,
        country: form.country === "other" ? form.countryOther.trim() : form.country,
        referred_by: form.referredBy.trim() || null,
        message: form.message.trim() || null,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e?.response?.data?.detail || "Une erreur est survenue. Merci de réessayer.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh relative overflow-hidden gradient-linkedin-soft">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(135deg, transparent 35%, rgba(255,255,255,0.55) 48%, transparent 60%)",
        }}
        aria-hidden
      />
      <div className="relative max-w-3xl mx-auto px-6 pt-10 pb-40">
        <Link to="/" className="inline-flex items-center gap-2.5 mb-8">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-zinc-900 text-white font-black text-sm">
            {BRAND.NAME.charAt(0)}
          </span>
          <span className="text-sm text-zinc-500">
            Programme Créateur <span className="font-bold text-zinc-900">{BRAND.NAME}</span>
          </span>
        </Link>

        {!submitted && (
          <div className="flex items-center gap-4 mb-10">
            <button
              type="button"
              onClick={goBack}
              className="grid place-items-center w-8 h-8 rounded-full text-zinc-500 hover:bg-black/5 transition-colors shrink-0"
              aria-label="Retour"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-200/80 overflow-hidden">
              <motion.div
                className="h-full rounded-full gradient-linkedin"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {submitted ? (
            <motion.div key="done" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <FinalConfirmation />
            </motion.div>
          ) : (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              {step === "social" && <SocialStep form={form} set={set} />}
              {step === "company" && <CompanyStep form={form} set={set} />}
              {step === "name" && <NameStep form={form} set={set} />}
              {step === "whatsapp" && (
                <WhatsappStep form={form} set={set} phoneCountries={phoneCountries} />
              )}
              {step === "whatsappConsent" && <WhatsappConsentStep form={form} set={set} />}
              {step === "email" && <EmailStep form={form} set={set} />}
              {step === "location" && <LocationStep form={form} set={set} />}
              {step === "final" && (
                <FinalStep
                  form={form}
                  set={set}
                  error={error}
                  submitting={submitting}
                  onSubmit={handleSubmit}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!submitted && step !== "final" && (
        <div className="fixed inset-x-0 bottom-0 border-t border-black/5 bg-gradient-to-t from-white via-white/95 to-transparent pt-8 pb-6">
          <div className="max-w-3xl mx-auto px-6">
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue()}
              className={continueButtonClass}
            >
              Plus loin
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepTitle({ children }) {
  return (
    <h1 className="font-display font-black text-3xl sm:text-4xl tracking-tight leading-tight text-zinc-900 mb-8">
      {children}
    </h1>
  );
}

function SocialStep({ form, set }) {
  return (
    <div>
      <StepTitle>Vos profils sur les réseaux sociaux</StepTitle>
      <Field label="TikTok">
        <div className="flex rounded-xl border border-zinc-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-linkedin/30">
          <span className="px-4 py-3 text-[15px] text-zinc-400 bg-zinc-50 border-r border-zinc-200 whitespace-nowrap">
            tiktok.com/@
          </span>
          <input
            value={form.tiktok}
            onChange={(e) => set({ tiktok: e.target.value })}
            placeholder="tonpseudo"
            className="flex-1 min-w-0 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
      </Field>
      <Field label="Instagram">
        <div className="flex rounded-xl border border-zinc-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-linkedin/30">
          <span className="px-4 py-3 text-[15px] text-zinc-400 bg-zinc-50 border-r border-zinc-200 whitespace-nowrap">
            instagram.com/
          </span>
          <input
            value={form.instagram}
            onChange={(e) => set({ instagram: e.target.value })}
            placeholder="tonpseudo"
            className="flex-1 min-w-0 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
      </Field>
    </div>
  );
}

function RadioCard({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-2xl border px-5 py-4 text-left text-[15px] ${
        selected ? sel.optionOn : sel.optionOff
      }`}
    >
      <span
        className={`grid place-items-center w-5 h-5 rounded-full border shrink-0 ${
          selected ? "bg-linkedin border-linkedin" : "border-zinc-300"
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-white" />}
      </span>
      {children}
    </button>
  );
}

function CompanyStep({ form, set }) {
  const options = [
    { id: "yes", label: "Oui, j'ai une entreprise." },
    { id: "planning", label: "Non, mais je suis prêt à en enregistrer une." },
    { id: "no", label: "Non, et je ne souhaite pas en enregistrer une." },
  ];
  return (
    <div>
      <StepTitle>Es-tu propriétaire d'une entreprise ?</StepTitle>
      <div className="space-y-3">
        {options.map((opt) => (
          <RadioCard
            key={opt.id}
            selected={form.hasCompany === opt.id}
            onClick={() => set({ hasCompany: opt.id })}
          >
            {opt.label}
          </RadioCard>
        ))}
      </div>
    </div>
  );
}

function NameStep({ form, set }) {
  return (
    <div>
      <StepTitle>Quel est ton nom ?</StepTitle>
      <Field label="Prénom">
        <input
          value={form.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
          placeholder="Prénom"
          className={inputClass}
        />
      </Field>
      <Field label="Nom de famille">
        <input
          value={form.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
          placeholder="Nom de famille"
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function WhatsappStep({ form, set, phoneCountries }) {
  return (
    <div>
      <StepTitle>Ton numéro WhatsApp</StepTitle>
      <Field label="Numéro WhatsApp">
        <div className="flex gap-2">
          <select
            value={form.whatsappCountry}
            onChange={(e) => {
              const iso2 = e.target.value;
              const match = phoneCountries.find((c) => c.iso2 === iso2);
              set({ whatsappCountry: iso2, whatsappDial: match?.dial || form.whatsappDial });
            }}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-3 text-[15px] text-zinc-900 focus:outline-none focus:ring-2 focus:ring-linkedin/30"
          >
            {phoneCountries.map((c) => (
              <option key={c.iso2} value={c.iso2}>
                {countryFlag(c.iso2)} {c.iso2} {c.dial}
              </option>
            ))}
          </select>
          <input
            value={form.whatsappNumber}
            onChange={(e) => set({ whatsappNumber: e.target.value.replace(/[^\d\s]/g, "") })}
            placeholder="6 12 34 56 78"
            className={`${inputClass} flex-1`}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Si ta candidature est acceptée, tu seras contactée via WhatsApp.
        </p>
      </Field>
    </div>
  );
}

function InfoCard({ icon: Icon, title, children }) {
  return (
    <div className="flex gap-3.5 rounded-2xl border border-zinc-200 bg-white p-4">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-linkedin-light text-linkedin shrink-0">
        <Icon className="w-4.5 h-4.5" />
      </span>
      <div>
        <p className="font-bold text-[15px] text-zinc-900 mb-0.5">{title}</p>
        <p className="text-sm text-zinc-500 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function WhatsappConsentStep({ form, set }) {
  return (
    <div>
      <StepTitle>Important : WhatsApp</StepTitle>
      <div className="space-y-3 mb-6">
        <InfoCard icon={MessageCircle} title="Communication WhatsApp">
          Si ta candidature est acceptée, tu seras averti via WhatsApp.
        </InfoCard>
        <InfoCard icon={AlarmClock} title="Réponds dans les 48 heures">
          Sinon, ta place pourrait être attribuée à quelqu'un d'autre.
        </InfoCard>
      </div>
      <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
        <input
          type="checkbox"
          checked={form.whatsappConsent}
          onChange={(e) => set({ whatsappConsent: e.target.checked })}
          className="w-4 h-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-300"
        />
        J'accepte d'être contactée par {BRAND.NAME}.
      </label>
    </div>
  );
}

function EmailStep({ form, set }) {
  return (
    <div>
      <StepTitle>Ton adresse e-mail</StepTitle>
      <Field label="Adresse email">
        <input
          type="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
          placeholder="toi@exemple.fr"
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function LocationStep({ form, set }) {
  return (
    <div>
      <StepTitle>Où es-tu situé(e) ?</StepTitle>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {FEATURED_COUNTRIES.map((c) => (
          <button
            key={c.iso2}
            type="button"
            onClick={() => set({ country: c.iso2 })}
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3.5 text-left text-[15px] ${
              form.country === c.iso2 ? sel.optionOn : sel.optionOff
            }`}
          >
            <span className="text-xs font-bold text-zinc-400">{c.iso2}</span>
            {c.label}
          </button>
        ))}
      </div>
      <select
        value={form.country === "other" ? "other" : ""}
        onChange={() => set({ country: "other" })}
        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-[15px] text-zinc-700 focus:outline-none focus:ring-2 focus:ring-linkedin/30"
      >
        <option value="">Un autre pays</option>
        <option value="other">Un autre pays...</option>
      </select>
      {form.country === "other" && (
        <input
          value={form.countryOther}
          onChange={(e) => set({ countryOther: e.target.value })}
          placeholder="Ton pays"
          className={`${inputClass} mt-3`}
        />
      )}
    </div>
  );
}

function FinalStep({ form, set, error, submitting, onSubmit }) {
  return (
    <div>
      <StepTitle>Voici ce qui se passe ensuite</StepTitle>
      <div className="space-y-3 mb-6">
        <InfoCard icon={Search} title="Ton profil est en cours de vérification.">
          Nous examinerons ton profil d'ici quelques jours.
        </InfoCard>
        <InfoCard icon={MessageCircle} title="Nous te recontacterons.">
          Si ta candidature est acceptée, nous te contacterons par WhatsApp.
        </InfoCard>
        <InfoCard icon={Rocket} title="Commence dès maintenant et gagne.">
          Tu commences à créer et à gagner !
        </InfoCard>
      </div>

      <Field label="As-tu été recommandée par quelqu'un ? (facultatif)">
        <input
          value={form.referredBy}
          onChange={(e) => set({ referredBy: e.target.value })}
          placeholder="Nom de la créatrice ou du créateur"
          className={inputClass}
        />
      </Field>
      <Field label="Des questions ? (facultatif)">
        <textarea
          value={form.message}
          onChange={(e) => set({ message: e.target.value })}
          placeholder="Qu'est-ce qui a failli t'empêcher de postuler ?"
          rows={3}
          className={`${inputClass} resize-none`}
        />
      </Field>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-full gradient-linkedin disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 text-base hover:enabled:opacity-90 transition-opacity shadow-[0_12px_40px_-12px_rgba(124,58,237,0.45)]"
      >
        <Send className="w-4 h-4" />
        {submitting ? "Envoi..." : "Soumettre"}
      </button>
    </div>
  );
}

function FinalConfirmation() {
  return (
    <div className="text-center py-10">
      <span className="mx-auto mb-6 grid place-items-center w-16 h-16 rounded-full bg-linkedin-light text-linkedin">
        <Send className="w-7 h-7" />
      </span>
      <h1 className="font-display font-black text-3xl tracking-tight text-zinc-900 mb-3">
        Candidature envoyée !
      </h1>
      <p className="text-zinc-500 max-w-md mx-auto mb-8">
        Merci ! Nous examinons ton profil et te recontactons par WhatsApp sous 48h si ta candidature
        est acceptée.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 rounded-full gradient-linkedin hover:opacity-90 text-white font-bold px-7 py-3 text-base transition-opacity"
      >
        Retour à l'accueil
      </Link>
    </div>
  );
}
