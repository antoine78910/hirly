export default function OnboardingIllustration({ src, alt = "", large = false, priority = false }) {
  const url = `${process.env.PUBLIC_URL || ""}${src}`;

  const imgProps = {
    src: url,
    alt,
    draggable: false,
    loading: priority ? "eager" : "lazy",
    decoding: "async",
    ...(priority ? { fetchPriority: "high" } : {}),
  };

  if (large) {
    return (
      <div
        className="w-[min(72vw,260px)] h-[min(72vw,260px)] sm:w-[300px] sm:h-[300px] lg:w-[320px] lg:h-[320px] flex items-center justify-center shrink-0"
        aria-hidden={!alt}
      >
        <img {...imgProps} className="max-w-full max-h-full w-full h-full object-contain" />
      </div>
    );
  }

  return (
    <div className="w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center shrink-0">
      <img {...imgProps} className="max-w-full max-h-full w-full h-full object-contain" />
    </div>
  );
}
