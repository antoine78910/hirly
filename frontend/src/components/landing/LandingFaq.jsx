import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getLandingFaq, getLandingFaqHeading } from "../../lib/landingFaq";

function FaqPart({ part }) {
  if (part.bold) return <strong>{part.bold}</strong>;
  if (part.link) {
    return (
      <a href={part.href} className="font-medium text-linkedin hover:underline">
        {part.link}
      </a>
    );
  }
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

  if (block.type === "li") {
    return (
      <li className="text-sm leading-relaxed text-zinc-600">
        {block.parts
          ? block.parts.map((part, _i) => <FaqPart key={JSON.stringify(part)} part={part} />)
          : block.text}
      </li>
    );
  }

  return (
    <p className="text-sm leading-relaxed text-zinc-600">
      {block.parts
        ? block.parts.map((part, _i) => <FaqPart key={JSON.stringify(part)} part={part} />)
        : block.text}
    </p>
  );
}

function FaqItem({ item, open, onToggle }) {
  const hasList = item.answer.some((b) => b.type === "li");

  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={[
          "w-full rounded-xl border text-left transition-all duration-200",
          open
            ? "border-zinc-200/80 bg-[#fdfdfd] shadow-[0_0_2px_rgba(0,0,0,0.25)]"
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
            {hasList ? (
              <ul className="space-y-2.5 pl-4 marker:text-zinc-300">
                {item.answer.map((block, _i) => (
                  <FaqBlock key={JSON.stringify(block)} block={block} />
                ))}
              </ul>
            ) : (
              <div className="space-y-2.5">
                {item.answer.map((block, _i) => (
                  <FaqBlock key={JSON.stringify(block)} block={block} />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </button>
    </li>
  );
}

export default function LandingFaq({ lang }) {
  const items = getLandingFaq(lang);
  const [openId, setOpenId] = useState(items[0]?.id ?? null);

  return (
    <section className="mx-auto max-w-3xl px-6 pb-20" data-testid="landing-faq">
      <h2 className="mb-8 text-center font-display text-3xl font-black tracking-tighter text-zinc-900 sm:text-4xl">
        {getLandingFaqHeading(lang)}
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
