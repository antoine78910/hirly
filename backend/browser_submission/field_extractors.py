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
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || /\\bhidden\\b|display-none|is-hidden/.test(classText)) return true;
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
    return /\\*|required|mandatory/.test(text) && !/optional/.test(text);
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
  ));
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


async def extract_fields(page: Any) -> List[Dict[str, Any]]:
    fields = await page.evaluate(FIELD_EXTRACTOR_SCRIPT)
    return [field for field in fields if isinstance(field, dict)]

