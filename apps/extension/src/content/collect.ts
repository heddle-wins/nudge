import type { RawPageContext, RawPageElement } from "@nudge/privacy-core";

/**
 * This function is self-contained so Chrome can execute it in an already-open tab
 * through chrome.scripting.executeScript. Do not reference module-level values here.
 */
export function collectRawPageContext(): RawPageContext {
  let nextElementId = 1;

  function isVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  }

  function roleFor(element: HTMLElement): RawPageElement["role"] {
    const explicitRole = element.getAttribute("role");
    if (explicitRole === "button" || element instanceof HTMLButtonElement) return "button";
    if (explicitRole === "link" || element instanceof HTMLAnchorElement) return "link";
    if (element instanceof HTMLSelectElement || explicitRole === "combobox") return "combobox";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      return "textbox";
    }
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (/^H[1-6]$/.test(element.tagName)) return "heading";
    return "unknown";
  }

  function accessibleName(element: HTMLElement): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labels = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (labels.length) return labels.join(" ");
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const label = element.labels?.[0]?.textContent?.trim();
      if (label) return label;
      const placeholder = element instanceof HTMLSelectElement ? "" : element.placeholder;
      return placeholder || element.name || element.id || "Unlabelled field";
    }
    return element.textContent?.trim().slice(0, 500) || element.getAttribute("title") || "Unlabelled element";
  }

  function rawElementFrom(element: HTMLElement): RawPageElement {
    const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    const input = element instanceof HTMLInputElement ? element : undefined;
    const id = `el_${nextElementId.toString(36).padStart(4, "0")}`;
    nextElementId += 1;

    return {
      id,
      role: roleFor(element),
      name: accessibleName(element),
      ...(field ? { value: element.value } : { text: element.textContent?.trim().slice(0, 2_000) }),
      ...(input ? { inputType: input.type, autocomplete: input.autocomplete } : {}),
      state: {
        enabled: !(element as HTMLButtonElement).disabled,
        visible: true,
        ...(field ? { required: (element as HTMLInputElement).required } : {})
      }
    };
  }

  const selectors = "button, a[href], input, textarea, select, [role='button'], [role='link'], [role='combobox'], h1, h2, h3";
  const elements = [...document.querySelectorAll<HTMLElement>(selectors)]
    .filter(isVisible)
    .slice(0, 150)
    .map(rawElementFrom);

  return { url: window.location.href, title: document.title, elements };
}
