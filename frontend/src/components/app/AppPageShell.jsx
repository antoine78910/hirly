/** Full-height shell for bottom-nav pages — scroll lives in AppPageScroll, not the document. */
export function AppPage({ children, className = "" }) {
  return (
    <div className={`flex h-dvh max-h-dvh flex-col overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

/** Wheel / trackpad / touch scroll area (use inside AppPage). */
export function AppPageScroll({ children, className = "", withBottomNavPad = true }) {
  return (
    <main
      className={`app-scroll no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${
        withBottomNavPad ? "pb-28" : ""
      } ${className}`}
    >
      {children}
    </main>
  );
}
