export const DESKTOP_SELF_MANAGED_ROUTES = new Set(["/swipe", "/app", "/settings"]);

export function isDesktopSelfManagedRoute(pathname) {
  return DESKTOP_SELF_MANAGED_ROUTES.has(pathname);
}

/** Shared content width for app pages inside the desktop shell. */
export const APP_CONTENT_WIDTH =
  "mx-auto w-full max-w-md px-safe sm:px-5 md:max-w-6xl md:px-8 lg:px-10";
