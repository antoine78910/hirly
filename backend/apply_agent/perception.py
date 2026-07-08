"""Universal DOM field extraction -- the one implementation for every ATS and
every arbitrary friendly custom career portal.

Nothing here is provider-specific; that's the point. The old system had a
copy of similar logic duplicated/specialized per ATS engine. Here, the exact
same script runs against any apply page, and the LLM agent (agent.py) reads
the resulting structured element list the way a human reads a form -- by
label and context, not by memorized selector.

Extends the field extractor's original single-document scan (main frame
only) with iframe traversal: many arbitrary company career portals embed
their application form in a same-origin iframe, which the original scan
would have silently returned zero fields for.
"""

from __future__ import annotations

from typing import Any, Dict, List

FIELD_EXTRACTOR_SCRIPT = r"""
() => {
  const cssEscape = window.CSS && window.CSS.escape
    ? window.CSS.escape
    : (value) => String(value).replace(/["\\#.:,[\]>+~*^$|=()\s]/g, "\\$&");

  function textOf(node) {
    if (!node) return "";
    return (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function selectorFor(element) {
    if (element.id) return "#" + cssEscape(element.id);
    if (element.name) {
      const tag = element.tagName.toLowerCase();
      return tag + "[name=\"" + String(element.name).replace(/"/g, "\\\"") + "\"]";
    }
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += "#" + cssEscape(node.id);
        parts.unshift(part);
        break;
      }
      let index = 1;
      let sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      part += ":nth-of-type(" + index + ")";
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function labelFor(element) {
    if (element.getAttribute("aria-label")) return element.getAttribute("aria-label").trim();
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
      if (label) return label;
    }
    if (element.id) {
      const explicit = document.querySelector("label[for=\"" + CSS.escape(element.id) + "\"]");
      if (explicit) return textOf(explicit);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((item) => item.remove());
      const label = textOf(clone);
      if (label) return label;
    }
    const fieldset = element.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) return textOf(legend);
    }
    const parent = element.closest(".application-question, .posting-form-question, .field, .form-field, div");
    if (parent) {
      const label = textOf(parent).slice(0, 220);
      if (label) return label;
    }
    return element.getAttribute("placeholder") || element.name || element.id || "";
  }

  function closestContainer(element) {
    return element.closest(
      ".application-question, .question, .field, .form-field, .input-wrapper, .select-wrapper, .select, .select__control, fieldset, li, div"
    );
  }

  function visibleElement(el) {
    if (!el) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return Boolean(rect.width > 0 && rect.height > 0 && el.getClientRects().length);
  }

  function hiddenByContainer(element) {
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      if (!visibleElement(node)) return true;
      const classText = String(node.className || "").toLowerCase();
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || /\bhidden\b|display-none|is-hidden/.test(classText)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function conditionalHintFor(element, container) {
    const text = [
      labelFor(element),
      element.getAttribute("placeholder") || "",
      element.getAttribute("aria-label") || "",
      container ? textOf(container) : "",
    ].join(" ").toLowerCase();
    return /please specify|if yes|if other|self[- ]?describe|other/.test(text);
  }

  function requiredMarkerFor(element, container) {
    const attrs = [
      element.required,
      element.getAttribute("aria-required") === "true",
      element.getAttribute("required") !== null,
    ];
    if (attrs.some(Boolean)) return true;
    const text = [
      labelFor(element),
      element.getAttribute("aria-label") || "",
      element.getAttribute("placeholder") || "",
      container ? textOf(container) : "",
    ].join(" ").toLowerCase();
    return /\*|required|mandatory/.test(text) && !/optional/.test(text);
  }

  function stableIdFor(element, index) {
    return [
      element.getAttribute("name") || "",
      element.id || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("placeholder") || "",
      labelFor(element) || "",
      String(index),
    ].filter(Boolean).join("|").toLowerCase().replace(/[^a-z0-9|]+/g, "_").slice(0, 220);
  }

  function widgetTypeFor(element, type, role) {
    const tag = element.tagName.toLowerCase();
    const container = closestContainer(element);
    const classText = [
      element.className || "",
      container ? container.className || "" : "",
    ].join(" ").toLowerCase();
    if (type === "file") return "file_upload";
    if (tag === "textarea" || type === "textarea") return "textarea";
    if (tag === "select" || type === "select") return "select";
    if (
      role === "combobox" ||
      type === "combobox" ||
      element.getAttribute("aria-haspopup") === "listbox" ||
      element.getAttribute("aria-haspopup") === "menu" ||
      /select__control|react-select|combobox|select-wrapper/.test(classText)
    ) return "combobox";
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    if (type === "tel" && /country|prefix|dial/.test((labelFor(element) + " " + textOf(container || element)).toLowerCase())) return "phone_widget";
    if (type === "tel") return "input";
    if (type === "contenteditable") return "textarea";
    return "input";
  }

  function nearbyTextFor(element) {
    const chunks = [];
    let node = element;
    for (let depth = 0; node && depth < 4; depth += 1) {
      if (node.previousElementSibling) chunks.push(textOf(node.previousElementSibling));
      node = node.parentElement;
    }
    return chunks.filter(Boolean).join(" ").slice(0, 500);
  }

  function optionsFor(element) {
    if (element.tagName.toLowerCase() === "select") {
      return Array.from(element.options || []).map((option) => ({
        value: option.value,
        label: textOf(option) || option.label || option.value,
      }));
    }
    if (element.type === "radio" || element.type === "checkbox") {
      const name = element.getAttribute("name") || "";
      const group = name
        ? Array.from(document.querySelectorAll("input[name=\"" + String(name).replace(/"/g, "\\\"") + "\"]"))
        : [element];
      return group.map((item) => ({value: item.value, label: labelFor(item)}));
    }
    const container = closestContainer(element);
    if (container) {
      const optionNodes = Array.from(container.querySelectorAll("[role='option'], option, li, button, [data-value]")).slice(0, 80);
      const options = optionNodes.map((item) => ({
        value: item.getAttribute("data-value") || item.getAttribute("value") || textOf(item),
        label: textOf(item) || item.getAttribute("aria-label") || item.getAttribute("data-value") || "",
      })).filter((item) => item.label || item.value);
      if (options.length) return options;
    }
    return [];
  }

  const nodes = Array.from(document.querySelectorAll(
    "input, textarea, select, [role='combobox'], [contenteditable='true'], button[aria-haspopup], [role='button'][aria-haspopup], [aria-haspopup='listbox'], [aria-haspopup='menu'], .select__control"
  )).filter((element) => {
    // Share-this-job widgets and language switchers are commonly built with
    // the same aria-haspopup/react-select-style markup as a real dropdown
    // field (confirmed live on Teamtailor/Workday pages), so the selector
    // above catches them too. A genuine form control -- including custom-
    // styled ones -- lives inside the application <form>; page furniture
    // like share/language menus lives in the header/nav, outside it. Only
    // applies to the heuristically-matched combobox-like nodes; real
    // input/textarea/select tags are trusted regardless of container.
    const tag = element.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return Boolean(element.closest("form"));
  });
  return nodes.map((element, index) => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
    const classText = String(element.className || "").toLowerCase();
    const type = tag === "textarea"
      ? "textarea"
      : tag === "select"
        ? "select"
        : role === "combobox"
          ? "combobox"
          : element.getAttribute("aria-haspopup") || /select__control|react-select|combobox/.test(classText)
            ? "combobox"
            : element.getAttribute("contenteditable") === "true"
              ? "contenteditable"
              : (element.getAttribute("type") || "text").toLowerCase();
    const ariaLabel = element.getAttribute("aria-label") || "";
    const ariaLabelledBy = element.getAttribute("aria-labelledby") || "";
    const container = closestContainer(element);
    const containerText = container ? textOf(container).slice(0, 1000) : "";
    const checked = Boolean(element.checked);
    const required = requiredMarkerFor(element, container);
    const widgetType = widgetTypeFor(element, type, role);
    const hiddenContainer = hiddenByContainer(element);
    const visible = !hiddenContainer && visibleElement(element);
    const value = type === "checkbox" || type === "radio"
      ? (checked ? (element.value || "on") : "")
      : (element.value || "");
    return {
      index,
      selector: selectorFor(element),
      stable_field_id: stableIdFor(element, index),
      tag,
      role,
      name: element.getAttribute("name") || "",
      id: element.id || "",
      type,
      widget_type: widgetType,
      label: labelFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      aria_label: ariaLabel,
      aria_labelledby: ariaLabelledBy,
      nearby_text: nearbyTextFor(element),
      surrounding_question_text: containerText || nearbyTextFor(element),
      field_container_text: containerText,
      required: visible ? required : false,
      required_marker: required,
      visible,
      hidden_container: hiddenContainer,
      conditional_hint: conditionalHintFor(element, container),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      checked,
      value_before: value,
      current_value: value,
      options: optionsFor(element),
    };
  });
}
"""


async def extract_fields(page: Any, *, max_frames: int = 6) -> List[Dict[str, Any]]:
    """Extract every interactive field from the page's main document AND any
    same-origin child frames (many arbitrary career-portal embeds render the
    actual application form inside an iframe). Cross-origin frames can't be
    introspected by design (browser security), and are skipped -- a job whose
    form only exists behind a cross-origin iframe surfaces zero fields here,
    which the caller treats the same as any other "form not found" case
    (blocker, fall back to manual).
    """
    fields: List[Dict[str, Any]] = []
    frames = list(getattr(page, "frames", None) or [page.main_frame])
    for frame_index, frame in enumerate(frames[:max_frames]):
        try:
            frame_fields = await frame.evaluate(FIELD_EXTRACTOR_SCRIPT)
        except Exception:
            # Cross-origin or already-navigated-away frame; skip silently.
            continue
        if not isinstance(frame_fields, list):
            continue
        for item in frame_fields:
            if not isinstance(item, dict):
                continue
            item["frame_index"] = frame_index
            fields.append(item)
    return fields


CLICKABLE_EXTRACTOR_SCRIPT = r"""
() => {
  function visible(el) {
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return Boolean(rect.width > 0 && rect.height > 0);
  }
  const nodes = Array.from(document.querySelectorAll("a, button, [role='button']")).filter(visible);
  return nodes.slice(0, 60).map((el, index) => ({
    index,
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
  })).filter((item) => item.text);
}
"""


async def extract_clickable_candidates(page: Any, *, frame_index: int = 0) -> List[Dict[str, Any]]:
    """Every visible button/link with text, for the LLM to pick an "Apply"
    call-to-action from when the phrase-list fast path in
    blockers.reveal_apply_form doesn't recognize it. Only the main frame --
    a same-origin iframe embedding the whole apply flow behind a landing
    page hasn't been seen in practice, and scanning every frame would blow
    up the candidate list this has to feed to the LLM.
    """
    frames = list(getattr(page, "frames", None) or [page.main_frame])
    frame = frames[frame_index] if 0 <= frame_index < len(frames) else page.main_frame
    try:
        candidates = await frame.evaluate(CLICKABLE_EXTRACTOR_SCRIPT)
    except Exception:
        return []
    return candidates if isinstance(candidates, list) else []


_CLICK_CANDIDATE_SCRIPT = r"""
(index) => {
  function visible(el) {
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return Boolean(rect.width > 0 && rect.height > 0);
  }
  const nodes = Array.from(document.querySelectorAll("a, button, [role='button']")).filter(visible).slice(0, 60);
  const target = nodes[index];
  if (!target) return false;
  target.click();
  return true;
}
"""


async def click_clickable_candidate(page: Any, index: int, *, frame_index: int = 0) -> bool:
    """Clicks the element at `index` in the exact same visible-button/link
    list extract_clickable_candidates built -- same query, same filter,
    same slice, so the index the LLM picked still points at the right
    element as long as the DOM hasn't meaningfully changed in between.
    """
    frames = list(getattr(page, "frames", None) or [page.main_frame])
    frame = frames[frame_index] if 0 <= frame_index < len(frames) else page.main_frame
    try:
        return bool(await frame.evaluate(_CLICK_CANDIDATE_SCRIPT, index))
    except Exception:
        return False


def looks_like_real_form(fields: List[Dict[str, Any]]) -> bool:
    """A job-summary landing page (confirmed live on Ashby, Flatchr,
    SmartRecruiters, Workday) may still expose a search box or a couple of
    header widgets that perception dutifully reports as "fields" -- but
    none of those are an actual application form. An email input or a file
    upload is a reliable, language-independent signal that the real form is
    on screen; landing pages never have either.
    """
    return any(field.get("type") == "email" or field.get("widget_type") == "file_upload" for field in fields)
