import { Link } from "react-router-dom";
import {
  PRIVACY_PATH,
  TERMS_PATH,
  legalHref,
  shouldOpenLegalInNewTab,
} from "../../lib/legalPaths";

export default function LegalLink({ page = "terms", className = "", children }) {
  const isPrivacy = page === "privacy";
  const path = isPrivacy ? PRIVACY_PATH : TERMS_PATH;
  const href = legalHref(page);

  if (shouldOpenLegalInNewTab()) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <Link to={path} className={className}>
      {children}
    </Link>
  );
}
