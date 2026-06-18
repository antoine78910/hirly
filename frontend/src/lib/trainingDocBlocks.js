/** Shared doc block builders for training module content. */

export function linkBlock(text, href) {
  if (href) return { type: "link", text, href };
  return { type: "paragraph", text };
}

export function heading(level, text) {
  return { type: "heading", level, text };
}

export function paragraph(text) {
  return { type: "paragraph", text };
}

export function infoScript(text) {
  return { type: "callout", variant: "info", text };
}

export function warningGuideline(text) {
  return { type: "callout", variant: "warning", text };
}

/** @param {Array<string|{label:string,url?:string}>} examples */
export function examplesGrid(examples) {
  return {
    type: "example_grid",
    items: examples.map((ex) => {
      if (typeof ex === "string") return ex;
      return { label: ex.label, url: ex.url || "" };
    }),
  };
}

/** @param {Array<string|{label:string,url?:string}>} examples */
export function examplesList(examples) {
  return {
    type: "list",
    style: "bullet",
    items: examples.map((ex) => {
      if (typeof ex === "string") return ex;
      return ex.url ? { text: ex.label, href: ex.url } : ex.label;
    }),
  };
}

/** @param {Array<string|{text:string,href?:string}>} items */
export function bulletList(items) {
  return {
    type: "list",
    style: "bullet",
    items: items.map((item) => {
      if (typeof item === "string") return item;
      return item.href ? { text: item.text, href: item.href } : item.text;
    }),
  };
}

export function sectionBlock({ section_id, title, video_url = "", content }) {
  return { section_id, title, video_url, content };
}
