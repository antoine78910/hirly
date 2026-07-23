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
  default: "max-h-6 max-w-[5.25rem] sm:max-h-7 md:max-h-8 sm:max-w-[9rem]",
  lg: "max-h-8 max-w-[7.25rem] sm:max-h-10 md:max-h-11 sm:max-w-[12rem]",
};

function TrustLogo({ name, src, scale = "default" }) {
  const boxClass =
    scale === "lg" ? "h-10 w-[7.75rem] sm:h-12 sm:w-44" : "h-9 w-[5.75rem] sm:h-12 sm:w-40";

  return (
    <div className={`flex shrink-0 items-center justify-center ${boxClass}`}>
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

function TrustLogoTrack({ logos, suffix, hidden = false, loose = false }) {
  return (
    <div
      className={`flex shrink-0 items-center sm:gap-16 sm:pr-16 ${
        loose ? "gap-8 pr-8" : "gap-5 pr-5"
      }`}
      aria-hidden={hidden || undefined}
    >
      {logos.map((logo) => (
        <TrustLogo
          key={`${logo.name}-${suffix}`}
          name={logo.name}
          src={logo.src}
          scale={logo.scale}
        />
      ))}
    </div>
  );
}

function TrustLogoMarqueeRow({ logos, reverse = false, duration = 36, loose = false }) {
  return (
    <div className="trust-marquee-mask w-full overflow-hidden">
      <div
        className={`flex w-max flex-nowrap items-center ${reverse ? "pain-marquee-right" : "pain-marquee-left"}`}
        style={{ animationDuration: `${duration}s` }}
      >
        {Array.from({ length: MARQUEE_COPIES }, (_, copy) => `c${copy}`).map((suffix) => (
          <TrustLogoTrack
            key={suffix}
            logos={logos}
            suffix={suffix}
            hidden={suffix !== "c0"}
            loose={loose}
          />
        ))}
      </div>
    </div>
  );
}

export default function LandingTrustLogos() {
  return (
    <div className="mt-6 w-[calc(100%+3rem)] max-w-none -mx-6 sm:mx-0 sm:w-full sm:max-w-5xl">
      <div className="relative flex flex-col gap-5 sm:gap-5">
        <TrustLogoMarqueeRow logos={TRUST_LOGO_ROW_1} duration={34} />
        <TrustLogoMarqueeRow logos={TRUST_LOGO_ROW_2} reverse duration={38} loose />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent sm:w-1/4" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-r from-transparent to-white sm:w-1/4" />
      </div>
    </div>
  );
}
