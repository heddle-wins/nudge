import { describe, expect, it } from "vitest";
import { proveExpectedPixelsRedacted } from "../src/vision/pixel-proof";

describe("rendered fixture pixel proof", () => {
  it("counts only exact final redaction pixels inside held-out labelled geometry", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([16, 21, 29, 255], offset);
    pixels.set([255, 255, 255, 255], (2 * 4 + 2) * 4);
    expect(proveExpectedPixelsRedacted(pixels, { width: 4, height: 4 }, [{ x: 1, y: 1, width: 2, height: 2 }])).toEqual({ expectedSensitivePixels: 4, redactedSensitivePixels: 3, residualSensitivePixels: 1 });
  });

  it("clips expected fixture geometry to the image", () => {
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([16, 21, 29, 255], offset);
    expect(proveExpectedPixelsRedacted(pixels, { width: 2, height: 2 }, [{ x: -2, y: -2, width: 3, height: 3 }])).toEqual({ expectedSensitivePixels: 1, redactedSensitivePixels: 1, residualSensitivePixels: 0 });
  });
});
