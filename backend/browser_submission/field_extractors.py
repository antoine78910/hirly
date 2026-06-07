"""DOM field extraction for browser application forms."""

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
      ".application-question, .question, .field, .form-field, .input-wrapper, .select-wrapper, fieldset, li, div"
    );
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
      return [{value: element.value, label: labelFor(element)}];
    }
    return [];
  }

  const nodes = Array.from(document.querySelectorAll(
    "input, textarea, select, [role='combobox'], [contenteditable='true']"
  ));
  return nodes.map((element, index) => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
      const type = tag === "textarea"
      ? "textarea"
      : tag === "select"
        ? "select"
        : role === "combobox"
          ? "combobox"
          : element.getAttribute("contenteditable") === "true"
            ? "contenteditable"
            : (element.getAttribute("type") || "text").toLowerCase();
    const ariaLabel = element.getAttribute("aria-label") || "";
    const ariaLabelledBy = element.getAttribute("aria-labelledby") || "";
    const container = closestContainer(element);
    const containerText = container ? textOf(container).slice(0, 1000) : "";
    const checked = Boolean(element.checked);
    const value = type === "checkbox" || type === "radio"
      ? (checked ? (element.value || "on") : "")
      : (element.value || "");
    return {
      index,
      selector: selectorFor(element),
      tag,
      role,
      name: element.getAttribute("name") || "",
      id: element.id || "",
      type,
      label: labelFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      aria_label: ariaLabel,
      aria_labelledby: ariaLabelledBy,
      nearby_text: nearbyTextFor(element),
      field_container_text: containerText,
      required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
      visible: Boolean(element.getAttribute("aria-hidden") !== "true" && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      checked,
      value_before: value,
      options: optionsFor(element),
    };
  });
}
"""


async def extract_fields(page: Any) -> List[Dict[str, Any]]:
    fields = await page.evaluate(FIELD_EXTRACTOR_SCRIPT)
    return [field for field in fields if isinstance(field, dict)]

