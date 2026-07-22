/**
 * Cross-origin embeds (Bunny, TikTok, Instagram) throw generic "Script error."
 * in dev — React's overlay treats them as app crashes. Filter that noise only.
 */
export function installDevEmbedErrorFilter() {
  if (process.env.NODE_ENV !== "development") return;

  window.addEventListener(
    "error",
    (event) => {
      const genericCrossOrigin = event.message === "Script error." && !event.filename;
      const embedFrame = event.target instanceof HTMLIFrameElement;

      if (genericCrossOrigin || embedFrame) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );
}
