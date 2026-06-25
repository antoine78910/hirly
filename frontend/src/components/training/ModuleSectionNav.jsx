import TrainingSectionBadge from "./TrainingSectionBadge";

export default function ModuleSectionNav({
  sections,
  activeSectionId,
  onSelect,
  variant = "tabs",
}) {
  if (!sections?.length) return null;

  if (variant === "sidebar") {
    return (
      <nav
        className="sticky top-16 z-10 w-[7.25rem] shrink-0 self-start border-r border-zinc-200 pr-2 sm:top-20 sm:w-48 sm:pr-4 max-h-[calc(100dvh-5rem)] overflow-y-auto"
        aria-label="Sub-chapters"
      >
        <ul className="flex flex-col gap-0.5">
          {sections.map((section, index) => {
            const active = section.section_id === activeSectionId;
            return (
              <li key={section.section_id}>
                <button
                  type="button"
                  onClick={() => onSelect(section.section_id)}
                  className={`relative w-full rounded-md px-2 py-2 text-left text-xs font-medium leading-snug transition-colors sm:px-3 sm:py-2.5 sm:text-sm ${
                    section.badge ? "pr-2 pt-3 sm:pr-3" : ""
                  } ${
                    active
                      ? "bg-violet-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <span className="block">
                    <span className="mr-1 text-[10px] font-semibold opacity-70 sm:text-xs">
                      {index + 1}.
                    </span>
                    {section.title}
                  </span>
                  {section.badge ? (
                    <TrainingSectionBadge
                      label={section.badge}
                      size="sm"
                      className="absolute -right-1 -top-1.5"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav className="flex flex-wrap gap-3 border-b border-zinc-100 pb-4" aria-label="Sub-chapters">
      {sections.map((section, index) => {
        const active = section.section_id === activeSectionId;
        return (
          <button
            key={section.section_id}
            type="button"
            onClick={() => onSelect(section.section_id)}
            className={`relative inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              section.badge ? "pr-3 pt-2.5" : ""
            } ${
              active
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            <span>
              {index + 1}. {section.title}
            </span>
            {section.badge ? (
              <TrainingSectionBadge
                label={section.badge}
                size="sm"
                className="absolute -right-1 -top-1.5"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
