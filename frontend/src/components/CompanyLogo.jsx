import { useEffect, useState } from "react";
import { getCompanyLogoUrls, getJobCompanyLogoUrl, resolveCompanyName } from "../lib/companyLogos";

const SIZE_STYLES = {
  sm: {
    box: "h-10 w-10",
    img: "h-6 w-6",
    text: "text-sm",
    pad: "p-1",
  },
  md: {
    box: "h-14 w-14",
    img: "h-9 w-9",
    text: "text-xl",
    pad: "p-1.5",
  },
  lg: {
    box: "h-16 w-20",
    img: "h-11 w-14",
    text: "text-2xl",
    pad: "p-2",
  },
};

const ROUNDED = {
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
};

export default function CompanyLogo({
  company,
  job,
  logoUrl,
  size = "md",
  rounded = "2xl",
  className = "",
}) {
  const resolved = resolveCompanyName(company || job?.company) || company || job?.company;
  const resolvedLogoUrl = logoUrl ?? getJobCompanyLogoUrl(job);
  const urls = getCompanyLogoUrls(resolved, resolvedLogoUrl);
  const [urlIndex, setUrlIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrlIndex(0);
    setFailed(false);
  }, []);

  const styles = SIZE_STYLES[size] || SIZE_STYLES.md;
  const round = ROUNDED[rounded] || ROUNDED["2xl"];
  const initial = (resolved || "?").trim().charAt(0).toUpperCase();
  const boxClass = [
    styles.box,
    styles.pad,
    round,
    "grid shrink-0 place-items-center border border-zinc-200/90 bg-white shadow-sm",
    className,
  ].join(" ");

  const activeLogoUrl = urls[urlIndex];

  const handleError = () => {
    if (urlIndex < urls.length - 1) {
      setUrlIndex((i) => i + 1);
    } else {
      setFailed(true);
    }
  };

  if (!activeLogoUrl || failed) {
    return (
      <div className={`${boxClass} font-display font-bold ${styles.text} text-zinc-800`}>
        {initial}
      </div>
    );
  }

  return (
    <div className={boxClass}>
      <img
        key={activeLogoUrl}
        src={activeLogoUrl}
        alt={`${resolved} logo`}
        className={`${styles.img} object-contain`}
        onError={handleError}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
