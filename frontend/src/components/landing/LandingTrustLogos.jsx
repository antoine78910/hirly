const MARQUEE_COPIES = 4;

/**
 * Logo files live in `frontend/public/trust-logos/` (served as `/trust-logos/...`).
 * Add a transparent `.png` there, then register it in the rows below.
 */
const TRUST_LOGO_ROW_1 = [
  { name: "Natixis", src: "/trust-logos/natixis.png" },
  { name: "Doctolib", src: "/trust-logos/doctolib.png" },
  { name: "Carrefour", src: "/trust-logos/carrefour.png" },
  { name: "McKinsey & Company", src: "/trust-logos/mckinsey.png" },
  { name: "L'Oréal", src: "/trust-logos/loreal.png" },
  { name: "Société Générale", src: "/trust-logos/societe-generale.png" },
];

const TRUST_LOGO_ROW_2 = [
  { name: "BNP Paribas", src: "/trust-logos/bnp-paribas.png", scale: "lg" },
  { name: "Sanofi", src: "/trust-logos/sanofi.png" },
  { name: "Lazard", src: "/trust-logos/lazard.png" },
  { name: "Bredin Prat", src: "/trust-logos/bredin-prat.png" },
  { name: "Publicis Groupe", src: "/trust-logos/publicis.png", scale: "lg" },
  { name: "Mistral AI", src: "/trust-logos/mistral-ai.png", scale: "lg" },
];

const LOGO_SIZE_CLASS = {
  default: "max-h-7 md:max-h-8 max-w-[9rem]",
  lg: "max-h-10 md:max-h-11 max-w-[12rem]",
};

function TrustLogo({ name, src, scale = "default" }) {
  return (
    <div className="flex h-11 w-36 shrink-0 items-center justify-center sm:h-12 sm:w-40">
      <img
        src={src}
        alt={name}
        className={`w-auto object-contain opacity-45 brightness-0 transition-opacity duration-300 hover:opacity-75 ${LOGO_SIZE_CLASS[scale] ?? LOGO_SIZE_CLASS.default}`}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function TrustLogoTrack({ logos, suffix, hidden = false }) {
  return (
    <div
      className="flex shrink-0 items-center gap-8 pr-8 sm:gap-16 sm:pr-16"
      aria-hidden={hidden || undefined}
    >
      {logos.map((logo) => (
        <TrustLogo key={`${logo.name}-${suffix}`} name={logo.name} src={logo.src} scale={logo.scale} />
      ))}
    </div>
  );
}

function TrustLogoMarqueeRow({ logos, reverse = false, duration = 36 }) {
  return (
    <div className="pain-marquee-mask w-full overflow-hidden">
      <div
        className={`flex w-max flex-nowrap items-center ${reverse ? "pain-marquee-right" : "pain-marquee-left"}`}
        style={{ animationDuration: `${duration}s` }}
      >
        {Array.from({ length: MARQUEE_COPIES }, (_, copy) => (
          <TrustLogoTrack
            key={copy}
            logos={logos}
            suffix={`c${copy}`}
            hidden={copy > 0}
          />
        ))}
      </div>
    </div>
  );
}

export default function LandingTrustLogos() {
  return (
    <div className="mt-6 w-full max-w-5xl">
      <div className="relative flex flex-col gap-5">
        <TrustLogoMarqueeRow logos={TRUST_LOGO_ROW_1} duration={42} />
        <TrustLogoMarqueeRow logos={TRUST_LOGO_ROW_2} reverse duration={48} />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-white to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-white to-transparent" />
      </div>
    </div>
  );
}
