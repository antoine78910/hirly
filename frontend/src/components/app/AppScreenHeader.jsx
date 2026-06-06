import Logo from "../Logo";
import { BRAND } from "../../lib/brand";

/** Centered Swiipr logo header (Sorce-style). */
export function BrandHeader({ rightAction, className = "" }) {
  return (
    <header className={`relative px-5 pt-5 pb-2 text-center ${className}`}>
      <div className="inline-flex items-center justify-center gap-2">
        <Logo size={22} />
        <span className="font-display text-xl font-black tracking-tight text-swiipr-gradient">
          {BRAND.NAME}
        </span>
      </div>
      {rightAction ? (
        <div className="absolute right-4 top-5">{rightAction}</div>
      ) : null}
    </header>
  );
}

/** Simple centered title header (Profile, Inbox search row, etc.). */
export function TitleHeader({ title, rightAction, className = "" }) {
  return (
    <header className={`relative px-5 pt-5 pb-3 text-center ${className}`}>
      <h1 className="font-display text-lg font-bold tracking-tight text-zinc-900">{title}</h1>
      {rightAction ? (
        <div className="absolute right-4 top-4">{rightAction}</div>
      ) : null}
    </header>
  );
}
