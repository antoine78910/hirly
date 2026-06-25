import { useState } from "react";

/**
 * Side nav + panel for accordion-style training themes (e.g. Hirly example videos).
 */
export default function TrainingThemeSidebar({ items, renderContent, className = "" }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const safeItems = items || [];
  const active = safeItems[activeIndex];

  if (!safeItems.length) return null;

  return (
    <div className={`flex items-start gap-3 sm:gap-5 ${className}`}>
      <nav
        className="sticky top-16 z-10 w-[7.25rem] shrink-0 self-start border-r border-zinc-200 pr-2 sm:top-20 sm:w-44 sm:pr-3 max-h-[calc(100dvh-5rem)] overflow-y-auto"
        aria-label="Themes"
      >
        <ul className="flex flex-col gap-0.5">
          {safeItems.map((item, index) => {
            const activeItem = index === activeIndex;
            return (
              <li key={item.title || `theme-${index}`}>
                <button
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`w-full rounded-md px-2 py-2 text-left text-xs font-medium leading-snug transition-colors sm:px-3 sm:text-sm ${
                    activeItem
                      ? "bg-violet-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  {item.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 space-y-4">
        {(active?.content || []).map((child, childIndex) =>
          renderContent(child, `${activeIndex}-${childIndex}`),
        )}
      </div>
    </div>
  );
}
