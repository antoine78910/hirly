export default function ModuleSectionNav({ sections, activeSectionId, onSelect }) {
  if (!sections?.length) return null;

  return (
    <nav className="flex flex-wrap gap-2 border-b border-zinc-100 pb-4" aria-label="Sub-chapters">
      {sections.map((section, index) => {
        const active = section.section_id === activeSectionId;
        return (
          <button
            key={section.section_id}
            type="button"
            onClick={() => onSelect(section.section_id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            <span>
              {index + 1}. {section.title}
            </span>
            {section.badge ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-900"
                }`}
              >
                {section.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
