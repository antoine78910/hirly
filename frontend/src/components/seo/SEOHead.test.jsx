import { act } from "react";
import { createRoot } from "react-dom/client";
import SEOHead from "./SEOHead";
import { publicCanonicalUrl, publicHreflangLinks } from "../../lib/publicLocaleRoutes";

global.IS_REACT_ACT_ENVIRONMENT = true;

describe("SEOHead locale metadata", () => {
  let container;
  let root;

  beforeEach(() => {
    document.head.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("keeps absolute canonical URLs intact and injects supplied hreflang links", () => {
    const canonical = publicCanonicalUrl("en", "/how-it-works");
    const alternates = publicHreflangLinks("/how-it-works", "https://tryhirly.com", ["en"]);
    act(() =>
      root.render(
        <SEOHead
          title="How it works"
          description="Description"
          canonical={canonical}
          alternates={alternates}
        />,
      ),
    );

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(canonical);
    expect(
      [...document.querySelectorAll('link[rel="alternate"]')].map((link) => ({
        hrefLang: link.getAttribute("hreflang"),
        href: link.getAttribute("href"),
      })),
    ).toEqual(alternates);
  });
});
