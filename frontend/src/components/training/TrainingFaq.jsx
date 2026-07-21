import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getTrainingFaq } from "../../lib/trainingFaq";

function FaqPart({ part }) {
  if (part.bold) return <strong className="font-semibold text-zinc-800">{part.bold}</strong>;
  return part.text || null;
}

function FaqBlock({ block }) {
  if (block.bold) {
    return (
      <p className="text-sm leading-relaxed text-zinc-600">
        <strong className="font-semibold text-zinc-800">{block.bold}</strong>
      </p>
    );
  }

  return (
    <p className="text-sm leading-relaxed text-zinc-600">
      {block.parts
        ? block.parts.map((part, i) => <FaqPart key={i} part={part} />)
        : block.text}
    </p>
  );
}

function FaqItem({ item, open, onToggle }) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={[
          "w-full rounded-xl border text-left transition-all duration-200",
          open
            ? "border-violet-200/80 bg-white shadow-[0_0_2px_rgba(139,92,246,0.15)]"
            : "border-transparent bg-zinc-50/80 hover:bg-zinc-50",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5 sm:py-4">
          <h3 className="font-display text-base font-bold leading-snug text-zinc-900 sm:text-[1.05rem]">
            {item.question}
          </h3>
          <ChevronDown
            className={[
              "mt-0.5 h-5 w-5 shrink-0 text-zinc-400 transition-transform duration-200",
              open ? "rotate-180" : "",
            ].join(" ")}
            aria-hidden
          />
        </div>
        {open ? (
          <div className="border-t border-zinc-100 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            <div className="space-y-2.5">
              {item.answer.map((block, i) => (
                <FaqBlock key={i} block={block} />
              ))}
            </div>
          </div>
        ) : null}
      </button>
    </li>
  );
}

export default function TrainingFaq({ lang, title }) {
  const items = getTrainingFaq(lang);
  const [openId, setOpenId] = useState(null);

  return (
    <section className="mt-10 sm:mt-12" data-testid="training-faq">
      <h2 className="mb-5 font-display text-xl font-bold tracking-tight text-zinc-900 sm:mb-6 sm:text-2xl">
        {title}
      </h2>
      <div className="rounded-[14px] border border-zinc-200/80 bg-white p-3 shadow-sm sm:p-4">
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <FaqItem
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId((prev) => (prev === item.id ? null : item.id))}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
