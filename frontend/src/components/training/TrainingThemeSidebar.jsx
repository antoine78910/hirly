import { useState } from "react";



import { TRAINING_SIDEBAR_STICKY_CLASS, TRAINING_SIDEBAR_WIDTH_CLASS } from "./trainingLayoutConstants";



/**

 * Side nav + panel for accordion-style training themes (e.g. Hirly example videos).

 */

export default function TrainingThemeSidebar({ items, renderContent, className = "" }) {

  const [activeIndex, setActiveIndex] = useState(0);

  const safeItems = items || [];

  const active = safeItems[activeIndex];



  if (!safeItems.length) return null;



  return (

    <div className={`training-theme-layout ${className}`}>

      <nav

        className={`${TRAINING_SIDEBAR_STICKY_CLASS} ${TRAINING_SIDEBAR_WIDTH_CLASS}`}

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

      <div className="training-theme-layout__panel space-y-4">

        {(active?.content || []).map((child, childIndex) =>

          renderContent(child, `${activeIndex}-${childIndex}`),

        )}

      </div>

    </div>

  );

}


