import Logo from "../Logo";
import { BRAND } from "../../lib/brand";

/** Centered Swiipr logo header (Sorce-style) — 3-column grid avoids overlap on narrow phones. */
export function BrandHeader({ rightAction, leftAction, className = "" }) {
  return (
    <header className={`px-safe pt-safe pb-2 sm:px-5 ${className}`}>
      <div className="mx-auto grid w-full max-w-md grid-cols-[2.25rem_1fr_2.25rem] items-center gap-1 sm:grid-cols-[2.5rem_1fr_2.5rem]">
        <div className="flex justify-start">
          {leftAction || null}
        </div>
        <div className="flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
          <Logo size={22} />
          <span className="truncate font-display text-lg font-black tracking-tight text-swiipr-gradient sm:text-xl">
            {BRAND.NAME}
          </span>
        </div>
        <div className="flex justify-end">
          {rightAction || null}
        </div>
      </div>
    </header>
  );
}

/** Simple centered title header — same 3-column layout for mobile safety. */
export function TitleHeader({ title, rightAction, leftAction, className = "" }) {
  return (
    <header className={`px-safe pt-safe pb-3 sm:px-5 ${className}`}>
      <div className="mx-auto grid w-full max-w-md grid-cols-[2.25rem_1fr_2.25rem] items-center gap-1 sm:grid-cols-[2.5rem_1fr_2.5rem]">
        <div className="flex justify-start">
          {leftAction || null}
        </div>
        <h1 className="truncate text-center font-display text-base font-bold tracking-tight text-zinc-900 sm:text-lg">
          {title}
        </h1>
        <div className="flex justify-end">
          {rightAction || null}
        </div>
      </div>
    </header>
  );
}
