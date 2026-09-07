import type { VisualRedactionRegion } from "@nudge/privacy-core";

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
