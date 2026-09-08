import type { PixelBox } from "./evaluation";

export type RenderedPixelProof = {
  expectedSensitivePixels: number;
  redactedSensitivePixels: number;
  residualSensitivePixels: number;
  /** Aggregate fixture geometry only; never source pixels or recognized text. */
  residualBounds?: { x: number; y: number; width: number; height: number };
};

const REDACTION_RGB = [16, 21, 29] as const;

/**
 * Test-only ground-truth verifier. Unlike the vision residue gate, this does
 * not run a detector over the output: it checks the pixels that the renderer
 * actually produced inside labelled fixture regions.
 */
export function proveExpectedPixelsRedacted(pixels: Uint8ClampedArray, image: { width: number; height: number }, expected: PixelBox[]): RenderedPixelProof {
  let expectedSensitivePixels = 0;
  let redactedSensitivePixels = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (const region of expected) {
    const left = Math.max(0, Math.ceil(region.x));
    const top = Math.max(0, Math.ceil(region.y));
    const right = Math.min(image.width, Math.floor(region.x + region.width));
    const bottom = Math.min(image.height, Math.floor(region.y + region.height));
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
      expectedSensitivePixels += 1;
      const offset = (y * image.width + x) * 4;
      if (pixels[offset] === REDACTION_RGB[0] && pixels[offset + 1] === REDACTION_RGB[1] && pixels[offset + 2] === REDACTION_RGB[2] && pixels[offset + 3] === 255) {
        redactedSensitivePixels += 1;
      } else {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  const residualSensitivePixels = expectedSensitivePixels - redactedSensitivePixels;
  return {
    expectedSensitivePixels,
    redactedSensitivePixels,
    residualSensitivePixels,
    ...(residualSensitivePixels ? { residualBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {})
  };
}

export async function proveRenderedFixturePixels(redactedDataUrl: string, image: { width: number; height: number }, expected: PixelBox[]): Promise<RenderedPixelProof> {
  const source = new Image();
  source.src = redactedDataUrl;
  await source.decode();
  if (source.naturalWidth !== image.width || source.naturalHeight !== image.height) throw new Error("Fixture render dimensions changed unexpectedly.");
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Nudge could not verify fixture render pixels.");
  context.drawImage(source, 0, 0);
  return proveExpectedPixelsRedacted(context.getImageData(0, 0, image.width, image.height).data, image, expected);
}
