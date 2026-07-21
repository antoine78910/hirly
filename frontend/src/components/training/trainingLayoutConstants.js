/** Shared layout classes for training side nav (below sticky top bar). */

/** Top bar is h-14 (3.5rem). */
export const TRAINING_TOPBAR_OFFSET = "top-14";

export const TRAINING_TOPBAR_HEIGHT_CLASS = "h-14";

/** Page content offset when the top bar is fixed (bar height + breathing room). */
export const TRAINING_PAGE_OFFSET_CLASS = "training-page-offset";

/** Full-height hub area below the offset top bar. */
export const TRAINING_VIEWPORT_FILL_CLASS = "training-viewport-fill";

/** Portaled top bar — see `.training-topbar` in index.css. */
export const TRAINING_TOPBAR_CLASS = "training-topbar";

export const TRAINING_SIDEBAR_WIDTH_CLASS = "w-[7.25rem] sm:w-44";

/** Inline sticky nav (nested panels, e.g. Hirly example themes). */
export const TRAINING_SIDEBAR_STICKY_CLASS = "training-sidebar-sticky shrink-0";

/** Fixed left rail — portaled to <body>, see `.training-sidebar-rail` in index.css. */
export const TRAINING_SIDEBAR_FIXED_CLASS = "training-sidebar-rail";

/** Main column when the fixed chapter rail is visible — see index.css. */
export const TRAINING_MAIN_WITH_FIXED_SIDEBAR_CLASS = "training-main-with-sidebar";

function normalizeTitle(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesMatch(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/** Drop leading headings that repeat the section title (sidebar / header already show it). */
export function stripDuplicateSectionHeadings(blocks, sectionTitle) {
  if (!blocks?.length || !sectionTitle) return blocks;

  let start = 0;
  while (start < blocks.length) {
    const block = blocks[start];
    if (block?.type === "heading" && titlesMatch(block.text, sectionTitle)) {
      start += 1;
      continue;
    }
    break;
  }

  return start > 0 ? blocks.slice(start) : blocks;
}
