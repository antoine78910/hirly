/** Group flat Content Bank blocks into expandable sections. */

const LABELS = {
  fr: {
    examples: "Exemples vidéo",
    guidelines: "Consignes",
    captions: "Exemples de légendes",
    scripts: "Scripts",
    resources: "Ressources",
  },
  en: {
    examples: "Video examples",
    guidelines: "Guidelines",
    captions: "Caption examples",
    scripts: "Scripts",
    resources: "Resources",
  },
};

function normalizeHeading(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

function categorizeHeading(text) {
  const h = normalizeHeading(text);
  if (/^examples?$|^exemples?$/.test(h)) return "examples";
  if (/^guidelines?$|^consignes?$/.test(h)) return "guidelines";
  if (
    /caption|legende|video caption|exemples? de legendes?|legendes? (video|hors)|accroche/.test(h)
  ) {
    return "captions";
  }
  if (/^main script$|^script principal$/.test(h)) return "script";
  if (/^variation\s*\d+/.test(h)) return "script";
  if (/^resources?$|^ressources?$/.test(h)) return "resources";
  return "other";
}

function isMainScriptTitle(text) {
  const h = normalizeHeading(text);
  return h === "main script" || h === "script principal";
}

export function structureContentBankBlocks(blocks, lang = "fr") {
  if (!blocks?.length) return blocks;
  if (blocks[0]?.type === "content_bank_folds") return blocks;

  const t = LABELS[lang === "en" ? "en" : "fr"] || LABELS.fr;
  const body = blocks.filter((b) => !(b.type === "heading" && b.level === 1));

  const buckets = {
    examples: [],
    guidelines: [],
    captions: [],
    resources: [],
  };
  const scriptItems = [];
  let scriptFold = null;

  let bucket = null;
  let inScripts = false;

  const flushScripts = () => {
    if (!scriptItems.length) return;
    scriptFold = {
      id: "scripts",
      title: t.scripts,
      scriptItems: scriptItems.map((item) => ({ ...item, blocks: [...item.blocks] })),
      defaultOpen: false,
    };
    scriptItems.length = 0;
    inScripts = false;
  };

  const setBucket = (id) => {
    flushScripts();
    bucket = id;
    inScripts = false;
  };

  for (const block of body) {
    if (block.type === "heading") {
      const cat = categorizeHeading(block.text);
      if (cat === "examples") {
        setBucket("examples");
        continue;
      }
      if (cat === "guidelines") {
        setBucket("guidelines");
        continue;
      }
      if (cat === "captions") {
        setBucket("captions");
        continue;
      }
      if (cat === "resources") {
        setBucket("resources");
        continue;
      }
      if (cat === "script") {
        bucket = null;
        inScripts = true;
        scriptItems.push({
          title: block.text,
          blocks: [],
          defaultOpen: isMainScriptTitle(block.text),
        });
        continue;
      }
      if (bucket && buckets[bucket]) {
        buckets[bucket].push(block);
      } else if (inScripts && scriptItems.length) {
        scriptItems[scriptItems.length - 1].blocks.push(block);
      }
      continue;
    }

    if (inScripts && scriptItems.length) {
      scriptItems[scriptItems.length - 1].blocks.push(block);
      continue;
    }

    if (bucket && buckets[bucket]) {
      buckets[bucket].push(block);
      continue;
    }

    if (block.type === "example_grid") {
      setBucket("examples");
      buckets.examples.push(block);
      continue;
    }

    buckets.guidelines.push(block);
    bucket = "guidelines";
  }

  flushScripts();

  const exampleExtras = buckets.examples.filter((b) => b.type !== "example_grid");
  if (exampleExtras.length) {
    buckets.guidelines.unshift(...exampleExtras);
    buckets.examples = buckets.examples.filter((b) => b.type === "example_grid");
  }

  const result = [
    { id: "examples", title: t.examples, blocks: buckets.examples, defaultOpen: true },
    { id: "guidelines", title: t.guidelines, blocks: buckets.guidelines, defaultOpen: false },
    { id: "captions", title: t.captions, blocks: buckets.captions, defaultOpen: false },
    { id: "resources", title: t.resources, blocks: buckets.resources, defaultOpen: false },
  ].filter((fold) => fold.blocks?.length);

  if (scriptFold) result.push(scriptFold);

  if (!result.length) return blocks;

  return [{ type: "content_bank_folds", folds: result }];
}
