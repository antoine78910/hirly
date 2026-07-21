const imageCache = new Map();

export function publicAssetUrl(path) {
  const base = process.env.PUBLIC_URL || "";
  return `${base}${path}`;
}

export function isImagePreloaded(src) {
  const url = publicAssetUrl(src);
  return imageCache.get(url)?.status === "loaded";
}

function injectLinkPreload(url) {
  if (typeof document === "undefined") return;
  const href = url.replace(/"/g, "");
  if (document.querySelector(`link[rel="preload"][as="image"][href="${href}"]`)) return;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = href;
  document.head.appendChild(link);
}

export function preloadImage(src) {
  const url = publicAssetUrl(src);
  const cached = imageCache.get(url);
  if (cached?.status === "loaded") return Promise.resolve();
  if (cached?.promise) return cached.promise;

  injectLinkPreload(url);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      imageCache.set(url, { status: "loaded" });
      resolve();
    };
    img.onerror = () => {
      imageCache.set(url, { status: "error" });
      reject(new Error(`Failed to preload image: ${url}`));
    };
    img.src = url;
  });

  imageCache.set(url, { status: "loading", promise });
  return promise;
}

export function preloadImages(paths = []) {
  const unique = [...new Set(paths.filter(Boolean))];
  return Promise.allSettled(unique.map((path) => preloadImage(path)));
}
