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
      ...(element.closest("[data-nudge-private='true']") ? { userMarkedPrivate: true } : {}),
      bounds: boundsFor(element),
      state: {
        enabled: !(element as HTMLButtonElement).disabled,
        visible: true,
        ...(field ? { required: (element as HTMLInputElement).required } : {})
      }
    };
  }

  function boundsFor(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  }

  const selectors = "button, a[href], input, textarea, select, [role='button'], [role='link'], [role='combobox'], h1, h2, h3";
  const elements = [...document.querySelectorAll<HTMLElement>(selectors)]
    .filter(isVisible)
    .slice(0, 150)
    .map(rawElementFrom);

  const visualElements: RawPageElement[] = [];
  const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let visualId = 1;
  let visualScanComplete = true;
  while ((node = textWalker.nextNode())) {
    if (visualElements.length >= 2_000) {
      visualScanComplete = false;
      break;
    }
    const parent = node.parentElement;
    const text = node.textContent?.trim();
    if (!parent || !text || text.length < 3 || !isVisible(parent)) continue;
    const bounds = boundsFor(parent);
    if (!bounds.width || !bounds.height) continue;
    visualElements.push({
      id: `visual_${visualId.toString(36).padStart(4, "0")}`,
      role: "text",
      name: "Visible page text",
      text: text.slice(0, 2_000),
      ...(parent.closest("[data-nudge-private='true']") ? { userMarkedPrivate: true } : {}),
      bounds,
      state: { enabled: true, visible: true }
    });
    visualId += 1;
  }

  return {
    url: window.location.href,
    title: document.title,
    elements,
    visualElements,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    visualScanComplete,
    hasUninspectableVisualContent: [...document.querySelectorAll<HTMLElement>("img, canvas, embed, object, iframe")]
      .some(isVisible)
  };
}

/** Also self-contained so it works for pages opened before Nudge was installed. */
export function markElementPrivate(elementId: string): boolean {
  const selectors = "button, a[href], input, textarea, select, [role='button'], [role='link'], [role='combobox'], h1, h2, h3";
  const candidates = [...document.querySelectorAll<HTMLElement>(selectors)].filter((element) => {
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  });
  const index = Number.parseInt(elementId.replace(/^el_/, ""), 36) - 1;
  const element = candidates[index];
  if (!element) return false;
  element.setAttribute("data-nudge-private", "true");
  return true;
}
