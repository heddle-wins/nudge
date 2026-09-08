import type { VisualRedactionRegion } from "@nudge/privacy-core";

/**
 * Paints known DOM-space privacy regions over the page just for a browser tab
 * capture. Canvas redaction still runs afterward; this is a second, fail-closed
 * layer for browser/compositor surfaces such as native input text.
 */
export async function applyTemporaryViewportMasks(regions: VisualRedactionRegion[], maskId: string): Promise<boolean> {
  const existing = document.getElementById(maskId);
  if (existing) return false;
  const root = document.createElement("div");
  root.id = maskId;
  root.setAttribute("aria-hidden", "true");
  // A closed shadow root prevents ordinary page CSS from targeting the mask
  // rectangles. The host's properties are inline !important so broad page
  // rules such as `div { display: none !important }` cannot hide the layer.
  const shadow = root.attachShadow({ mode: "closed" });
  const rootStyle: Record<string, string> = {
    all: "initial", position: "fixed", inset: "0", display: "block",
    visibility: "visible", opacity: "1", pointerEvents: "none", zIndex: "2147483647"
  };
  for (const [property, value] of Object.entries(rootStyle)) root.style.setProperty(property, value, "important");
  for (const region of regions) {
    if (region.coordinateSpace === "image") continue;
    const mask = document.createElement("div");
    const padding = 4;
    const maskStyle: Record<string, string> = {
      position: "fixed", display: "block", visibility: "visible", opacity: "1",
      left: `${Math.max(0, region.x - padding)}px`, top: `${Math.max(0, region.y - padding)}px`,
      width: `${Math.max(0, region.width + padding * 2)}px`, height: `${Math.max(0, region.height + padding * 2)}px`,
      background: "#10151d"
    };
    for (const [property, value] of Object.entries(maskStyle)) mask.style.setProperty(property, value, "important");
    shadow.append(mask);
  }
  document.documentElement.append(root);
  // Two frames make this a capture barrier even when a page has native form
  // controls that Chrome composites separately from ordinary DOM paint.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return true;
}

/** Removes only the capture mask identified by this call; never page content. */
export function removeTemporaryViewportMasks(maskId: string): void {
  document.getElementById(maskId)?.remove();
}

/** Capture only while the locally-created mask host is still attached. */
export function hasTemporaryViewportMasks(maskId: string): boolean {
  const root = document.getElementById(maskId);
  return Boolean(root?.isConnected && root.getAttribute("aria-hidden") === "true");
}

/**
 * Receives a browser-captured image only inside the extension, masks all locally
 * detected regions, and returns the redacted image. The original data URL is never
 * returned to the side panel or included in the Nudge context contract.
 *
 * It has no module-level dependencies so it can also be executed in an already-open
 * page through chrome.scripting.executeScript.
 */
export async function renderRedactedViewport(
  rawCapture: string,
  regions: VisualRedactionRegion[],
  viewport: { width: number; height: number }
): Promise<string> {
  const image = new Image();
  image.src = rawCapture;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nudge could not create a local redaction canvas.");

  context.drawImage(image, 0, 0);
  const scaleX = image.naturalWidth / Math.max(1, viewport.width);
  const scaleY = image.naturalHeight / Math.max(1, viewport.height);
  context.fillStyle = "#10151d";

  for (const region of regions) {
    const padding = 4;
    const scale = region.coordinateSpace === "image" ? { x: 1, y: 1 } : { x: scaleX, y: scaleY };
    context.fillRect(
      Math.max(0, (region.x - padding) * scale.x),
      Math.max(0, (region.y - padding) * scale.y),
      Math.min(image.naturalWidth, (region.width + padding * 2) * scale.x),
      Math.min(image.naturalHeight, (region.height + padding * 2) * scale.y)
    );
  }

  return canvas.toDataURL("image/png");
}
