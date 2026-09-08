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

  function userMarkedVisualRegions() {
    try {
      const stored = JSON.parse(document.documentElement.getAttribute("data-nudge-visual-regions") ?? "[]") as unknown;
      if (!Array.isArray(stored)) return [];
      return stored.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const region = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
        if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) return [];
        const x = Math.max(0, Math.min(window.innerWidth, region.x as number));
        const y = Math.max(0, Math.min(window.innerHeight, region.y as number));
        const right = Math.max(x, Math.min(window.innerWidth, x + Math.max(0, region.width as number)));
        const bottom = Math.max(y, Math.min(window.innerHeight, y + Math.max(0, region.height as number)));
        return right - x >= 4 && bottom - y >= 4 ? [{ x, y, width: right - x, height: bottom - y }] : [];
      }).slice(0, 20);
    } catch {
      return [];
    }
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

  const markedRegions = userMarkedVisualRegions();
  // A CSS URL can paint arbitrary raster content even when there is no <img>
  // node for the DOM inventory. Do not allow that page to export a screenshot
  // based only on text/field inspection. Gradients are not URLs and remain
  // inspectable layout decoration.
  const hasCssUrlVisualContent = [...document.querySelectorAll<HTMLElement>("*")]
    .some((element) => {
      if (!isVisible(element)) return false;
      const style = window.getComputedStyle(element);
      if ([style.backgroundImage, style.borderImageSource, style.listStyleImage, style.maskImage]
        .some((value) => /url\s*\(/i.test(value))) return true;
      // Generated content is painted but absent from the text tree. It may be
      // a label, an attr()-derived value, or a URL-backed image, so fail closed
      // instead of attempting to infer its sensitivity from a DOM node.
      return ["::before", "::after"].some((pseudo) => {
        const content = window.getComputedStyle(element, pseudo).content;
        return Boolean(content && content !== "none" && content !== "normal");
      });
    });
  return {
    url: window.location.href,
    title: document.title,
    elements,
    visualElements,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    visualScanComplete,
    hasUninspectableVisualContent: hasCssUrlVisualContent || [...document.querySelectorAll<HTMLElement>("img, canvas, embed, object, iframe, video")]
      .some(isVisible),
    ...(markedRegions.length ? { userMarkedVisualRegions: markedRegions } : {})
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

/**
 * Opens a local, one-shot drag selection. It is self-contained so the background
 * can inject it into a tab that pre-dates extension installation.
 */
export function beginVisualPrivacyMark(): Promise<boolean> {
  const existing = document.getElementById("nudge-visual-privacy-picker");
  if (existing) return Promise.resolve(false);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    const selection = document.createElement("div");
    const hint = document.createElement("div");
    overlay.id = "nudge-visual-privacy-picker";
    hint.textContent = "Drag over an area to keep private · Esc to cancel";
    Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "2147483647", cursor: "crosshair", background: "rgba(16, 21, 29, .16)", userSelect: "none" });
    Object.assign(selection.style, { position: "fixed", display: "none", border: "2px solid #ffbe0b", background: "rgba(255, 190, 11, .18)", pointerEvents: "none" });
    Object.assign(hint.style, { position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)", padding: "9px 13px", borderRadius: "8px", background: "#10151d", color: "#fff", font: "600 14px system-ui", boxShadow: "0 4px 20px rgba(0,0,0,.32)", pointerEvents: "none" });
    overlay.append(selection, hint);
    document.documentElement.append(overlay);
    let start: { x: number; y: number } | undefined;
    let settled = false;
    const finish = (saved: boolean) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      window.removeEventListener("keydown", onKeyDown, true);
      resolve(saved);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") finish(false); };
    const draw = (end: { x: number; y: number }) => {
      if (!start) return { x: 0, y: 0, width: 0, height: 0 };
      const x = Math.max(0, Math.min(start.x, end.x));
      const y = Math.max(0, Math.min(start.y, end.y));
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      Object.assign(selection.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
      return { x, y, width, height };
    };
    overlay.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
      overlay.setPointerCapture(event.pointerId);
      draw(start);
    });
    overlay.addEventListener("pointermove", (event) => { if (start) draw({ x: event.clientX, y: event.clientY }); });
    overlay.addEventListener("pointerup", (event) => {
      const region = draw({ x: event.clientX, y: event.clientY });
      if (region.width < 4 || region.height < 4) return finish(false);
      let existingRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
      try {
        const parsed = JSON.parse(document.documentElement.getAttribute("data-nudge-visual-regions") ?? "[]");
        if (Array.isArray(parsed)) existingRegions = parsed.filter((value): value is typeof region => value && typeof value === "object").slice(0, 19);
      } catch { /* replace malformed local state */ }
      document.documentElement.setAttribute("data-nudge-visual-regions", JSON.stringify([...existingRegions, region]));
      finish(true);
    });
    window.addEventListener("keydown", onKeyDown, true);
  });
}
