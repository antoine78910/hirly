import { useEffect } from "react";

/**
 * Updates document.title, meta description, canonical, alternate locale links, and JSON-LD.
 * `canonical` accepts an internal pathname (legacy callers) or an absolute HTTPS URL;
 * alternate hrefs are always supplied as absolute URLs by publicLocaleRoutes.
 * Cleans up on unmount.
 */
export default function SEOHead({ title, description, keywords, canonical, alternates, jsonLd }) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);

  useEffect(() => {
    let tag = document.querySelector('meta[name="description"]');
    const created = !tag;
    if (created) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      document.head.appendChild(tag);
    }
    const prev = tag.getAttribute("content");
    tag.setAttribute("content", description);
    return () => {
      if (created) tag.remove();
      else tag.setAttribute("content", prev ?? "");
    };
  }, [description]);

  useEffect(() => {
    if (!canonical) return;
    let link = document.querySelector('link[rel="canonical"]');
    const created = !link;
    if (created) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    const prev = link.getAttribute("href");
    link.setAttribute("href", canonical.startsWith("http") ? canonical : `https://tryhirly.com${canonical}`);
    return () => {
      if (created) link.remove();
      else link.setAttribute("href", prev ?? "");
    };
  }, [canonical]);

  useEffect(() => {
    if (!alternates?.length) return undefined;
    const links = alternates.map(({ hrefLang, href }) => {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("hreflang", hrefLang);
      link.setAttribute("href", href);
      link.setAttribute("data-hirly-seo-alternate", "true");
      document.head.appendChild(link);
      return link;
    });
    return () => links.forEach((link) => link.remove());
  }, [alternates]);

  useEffect(() => {
    if (!keywords) return;
    let tag = document.querySelector('meta[name="keywords"]');
    const created = !tag;
    if (created) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "keywords");
      document.head.appendChild(tag);
    }
    const prev = tag.getAttribute("content");
    tag.setAttribute("content", keywords);
    return () => {
      if (created) tag.remove();
      else tag.setAttribute("content", prev ?? "");
    };
  }, [keywords]);

  useEffect(() => {
    if (!jsonLd) return;
    const items = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
    const scripts = items.map((obj) => {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(obj);
      document.head.appendChild(script);
      return script;
    });
    return () => scripts.forEach((script) => script.remove());
  }, [jsonLd]);

  return null;
}
