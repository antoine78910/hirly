import { useEffect } from "react";

/**
 * Updates document.title, meta description, canonical, and injects JSON-LD.
 * Cleans up on unmount.
 */
export default function SEOHead({ title, description, keywords, canonical, jsonLd }) {
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
    link.setAttribute("href", `https://tryhirly.com${canonical}`);
    return () => {
      if (created) link.remove();
      else link.setAttribute("href", prev ?? "");
    };
  }, [canonical]);

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
