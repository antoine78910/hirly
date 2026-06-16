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
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {index + 1}. {section.title}
          </button>
        );
      })}
    </nav>
  );
}
