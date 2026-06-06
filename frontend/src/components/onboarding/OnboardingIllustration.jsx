export default function OnboardingIllustration({ src, alt = "", large = false }) {
  const url = `${process.env.PUBLIC_URL || ""}${src}`;

  if (large) {
    return (
      <div
        className="w-[min(72vw,260px)] h-[min(72vw,260px)] sm:w-[300px] sm:h-[300px] lg:w-[320px] lg:h-[320px] flex items-center justify-center shrink-0"
        aria-hidden={!alt}
      >
        <img
          src={url}
          alt={alt}
          className="max-w-full max-h-full w-full h-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center shrink-0">
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-full w-full h-full object-contain"
        draggable={false}
      />
    </div>
  );
}
