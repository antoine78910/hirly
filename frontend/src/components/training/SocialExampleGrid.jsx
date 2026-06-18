import SocialExampleCard from "./SocialExampleCard";

export default function SocialExampleGrid({ items, lang = "en" }) {
  if (!items?.length) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {items.map((item) => {
        const label = typeof item === "string" ? item : item.label || item.text;
        const url = typeof item === "string" ? "" : item.url || item.href;
        if (!url) return null;
        return (
          <SocialExampleCard
            key={`${label}-${url}`}
            label={label}
            url={url}
            lang={lang}
          />
        );
      })}
    </div>
  );
}
