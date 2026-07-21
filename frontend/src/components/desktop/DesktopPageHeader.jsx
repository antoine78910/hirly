import { useDesktopTheme } from "./DesktopAppShell";

export default function DesktopPageHeader({ title, subtitle, actions = null }) {
  const { isDark } = useDesktopTheme();

  if (!title) return null;

  return (
    <header className="mb-8 hidden md:flex md:items-start md:justify-between md:gap-4">
      <div className="min-w-0">
        <h1
          className={`font-display text-3xl font-bold tracking-tight lg:text-4xl ${
            isDark ? "text-white" : "text-zinc-900"
          }`}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className={`mt-2 max-w-2xl text-base ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
