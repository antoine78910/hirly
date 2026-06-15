import { useEffect } from "react";

/** Lock document scroll so wheel / touch scroll only happens in `.app-scroll` regions. */
export default function AppScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("app-shell-locked");
    body.classList.add("app-shell-locked");

    return () => {
      html.classList.remove("app-shell-locked");
      body.classList.remove("app-shell-locked");
    };
  }, []);

  return null;
}
