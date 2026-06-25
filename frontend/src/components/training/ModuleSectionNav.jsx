import { createPortal } from "react-dom";

import TrainingSectionBadge from "./TrainingSectionBadge";

import {

  TRAINING_SIDEBAR_FIXED_CLASS,

  TRAINING_SIDEBAR_STICKY_CLASS,

  TRAINING_SIDEBAR_WIDTH_CLASS,

} from "./trainingLayoutConstants";



export default function ModuleSectionNav({

  sections,

  activeSectionId,

  onSelect,

  variant = "tabs",

  placement = "sticky",

}) {

  if (!sections?.length) return null;



  if (variant === "sidebar") {

    const shellClass =

      placement === "fixed"

        ? `${TRAINING_SIDEBAR_FIXED_CLASS} ${TRAINING_SIDEBAR_WIDTH_CLASS}`

        : `${TRAINING_SIDEBAR_STICKY_CLASS} ${TRAINING_SIDEBAR_WIDTH_CLASS}`;



    const nav = (

      <nav className={shellClass} aria-label="Sub-chapters" data-training-sidebar>

        <ul className="flex flex-col gap-1.5">

          {sections.map((section, index) => {

            const active = section.section_id === activeSectionId;

            return (

              <li key={section.section_id}>

                <button

                  type="button"

                  onClick={() => onSelect(section.section_id)}

                  className={`relative w-full overflow-visible rounded-md px-2 py-2 text-left text-xs font-medium leading-snug transition-colors sm:px-2.5 sm:py-2.5 sm:text-[13px] ${

                    section.badge ? "mt-1 mr-1" : ""

                  } ${

                    active

                      ? "bg-violet-600 text-white"

                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"

                  }`}

                >

                  {section.badge ? (

                    <TrainingSectionBadge

                      label={section.badge}

                      size="xs"

                      active={active}

                    />

                  ) : null}

                  <span className="block">

                    <span className="mr-1 text-[10px] font-semibold opacity-60">

                      {index + 1}.

                    </span>

                    {section.title}

                  </span>

                </button>

              </li>

            );

          })}

        </ul>

      </nav>

    );



    if (placement === "fixed" && typeof document !== "undefined") {

      return createPortal(nav, document.body);

    }

    return nav;

  }



  return (

    <nav className="flex flex-wrap gap-2.5 border-b border-zinc-100 pb-4" aria-label="Sub-chapters">

      {sections.map((section, index) => {

        const active = section.section_id === activeSectionId;

        return (

          <button

            key={section.section_id}

            type="button"

            onClick={() => onSelect(section.section_id)}

            className={`relative inline-flex max-w-full overflow-visible rounded-full px-3 py-1.5 text-left text-sm font-medium transition-colors ${

              section.badge ? "mt-1 mr-1" : ""

            } ${

              active

                ? "bg-violet-600 text-white"

                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"

            }`}

          >

            {section.badge ? (

              <TrainingSectionBadge label={section.badge} size="xs" active={active} />

            ) : null}

            <span>

              {index + 1}. {section.title}

            </span>

          </button>

        );

      })}

    </nav>

  );

}


