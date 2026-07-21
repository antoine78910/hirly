import { useState } from "react";
import { ChevronDown } from "lucide-react";

export default function MarketingFaq({ items }) {
  const [openId, setOpenId] = useState(items[0]?.id ?? null);

  return (
    <div className="rounded-[14px] border border-zinc-200/80 bg-white p-3 shadow-sm sm:p-4">
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="list-none">
            <button
              type="button"
              onClick={() => setOpenId((prev) => (prev === item.id ? null : item.id))}
              aria-expanded={openId === item.id}
              className={[
                "w-full rounded-xl border text-left transition-all duration-200",
                openId === item.id
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
                    openId === item.id ? "rotate-180" : "",
                  ].join(" ")}
                  aria-hidden
                />
              </div>
              {openId === item.id && (
                <div className="border-t border-zinc-100 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
                  <p className="text-sm leading-relaxed text-zinc-600">{item.answer}</p>
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
