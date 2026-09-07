import type { PiiKind } from "@nudge/contracts";

export type PixelBox = { x: number; y: number; width: number; height: number };
export type LabelledPrivacyRegion = PixelBox & { kind: PiiKind };

export type RedactionMetrics = {
  expectedRegions: number;
  protectedRegions: number;
  missedRegions: number;
  residualSensitivePixels: number;
  protectedSensitivePixels: number;
  predictedMaskPixels: number;
  overRedactedPixels: number;
  coverage: number;
  overRedactionRate: number;
  byKind: Partial<Record<PiiKind, { expected: number; protected: number; missed: number }>>;
};

type NormalizedBox = PixelBox & { right: number; bottom: number };

function normalize(box: PixelBox, width: number, height: number): NormalizedBox | undefined {
  const x = Math.max(0, Math.min(width, box.x));
  const y = Math.max(0, Math.min(height, box.y));
  const right = Math.max(x, Math.min(width, box.x + Math.max(0, box.width)));
  const bottom = Math.max(y, Math.min(height, box.y + Math.max(0, box.height)));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y, right, bottom } : undefined;
}

function contains(box: NormalizedBox, x: number, y: number) {
  return x >= box.x && x < box.right && y >= box.y && y < box.bottom;
}

function coveredArea(region: NormalizedBox, masks: NormalizedBox[]) {
  const xs = [...new Set([region.x, region.right, ...masks.flatMap((mask) => [Math.max(region.x, mask.x), Math.min(region.right, mask.right)])])]
    .filter((value) => value >= region.x && value <= region.right).sort((a, b) => a - b);
  const ys = [...new Set([region.y, region.bottom, ...masks.flatMap((mask) => [Math.max(region.y, mask.y), Math.min(region.bottom, mask.bottom)])])]
    .filter((value) => value >= region.y && value <= region.bottom).sort((a, b) => a - b);
  let area = 0;
  for (let xi = 0; xi < xs.length - 1; xi += 1) for (let yi = 0; yi < ys.length - 1; yi += 1) {
    const x = xs[xi]!;
    const y = ys[yi]!;
    if (masks.some((mask) => contains(mask, x, y))) area += (xs[xi + 1]! - x) * (ys[yi + 1]! - y);
  }
  return area;
}

/**
 * Computes deterministic fixture metrics using the actual redaction rectangles.
 * A protected region needs 99% pixel coverage: padding is allowed, pixel leaks are not.
 */
export function evaluateRedaction(
  screenshot: { width: number; height: number },
  expected: LabelledPrivacyRegion[],
  masks: PixelBox[],
  protectedCoverage = 0.99
): RedactionMetrics {
  if (!Number.isFinite(screenshot.width) || !Number.isFinite(screenshot.height) || screenshot.width <= 0 || screenshot.height <= 0) {
    throw new Error("Evaluation requires positive screenshot dimensions.");
  }
  if (protectedCoverage <= 0 || protectedCoverage > 1) throw new Error("Protected coverage must be in (0, 1].");
  const expectedBoxes: Array<{ kind: PiiKind; box: NormalizedBox }> = [];
  for (const region of expected) {
    const box = normalize(region, screenshot.width, screenshot.height);
    if (box) expectedBoxes.push({ kind: region.kind, box });
  }
  const maskBoxes: NormalizedBox[] = [];
  for (const mask of masks) {
    const box = normalize(mask, screenshot.width, screenshot.height);
    if (box) maskBoxes.push(box);
  }
  const byKind: RedactionMetrics["byKind"] = {};
  let protectedRegions = 0;
  let protectedSensitivePixels = 0;
  let residualSensitivePixels = 0;

  for (const { kind, box } of expectedBoxes) {
    const area = box.width * box.height;
    const covered = coveredArea(box, maskBoxes);
    const protectedRegion = covered / area >= protectedCoverage;
    const kindMetrics = byKind[kind] ?? { expected: 0, protected: 0, missed: 0 };
    kindMetrics.expected += 1;
    if (protectedRegion) {
      protectedRegions += 1;
      kindMetrics.protected += 1;
    } else kindMetrics.missed += 1;
    protectedSensitivePixels += covered;
    residualSensitivePixels += area - covered;
    byKind[kind] = kindMetrics;
  }

  const boundsX = [...new Set([0, screenshot.width, ...expectedBoxes.flatMap(({ box }) => [box.x, box.right]), ...maskBoxes.flatMap((box) => [box.x, box.right])])].sort((a, b) => a - b);
  const boundsY = [...new Set([0, screenshot.height, ...expectedBoxes.flatMap(({ box }) => [box.y, box.bottom]), ...maskBoxes.flatMap((box) => [box.y, box.bottom])])].sort((a, b) => a - b);
  let predictedMaskPixels = 0;
  let overRedactedPixels = 0;
  for (let xi = 0; xi < boundsX.length - 1; xi += 1) for (let yi = 0; yi < boundsY.length - 1; yi += 1) {
    const x = boundsX[xi]!;
    const y = boundsY[yi]!;
    const area = (boundsX[xi + 1]! - x) * (boundsY[yi + 1]! - y);
    if (!maskBoxes.some((box) => contains(box, x, y))) continue;
    predictedMaskPixels += area;
    if (!expectedBoxes.some(({ box }) => contains(box, x, y))) overRedactedPixels += area;
  }
  const expectedPixels = protectedSensitivePixels + residualSensitivePixels;
  return {
    expectedRegions: expectedBoxes.length,
    protectedRegions,
    missedRegions: expectedBoxes.length - protectedRegions,
    residualSensitivePixels,
    protectedSensitivePixels,
    predictedMaskPixels,
    overRedactedPixels,
    coverage: expectedPixels === 0 ? 1 : protectedSensitivePixels / expectedPixels,
    overRedactionRate: predictedMaskPixels === 0 ? 0 : overRedactedPixels / predictedMaskPixels,
    byKind
  };
}
