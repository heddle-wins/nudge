import { describe, expect, it } from "vitest";
import { assertOcrRegionBudget, decodePpOcrRegions, decodePpOcrText, preprocessPpOcrDetector, preprocessPpOcrRecognizer } from "../src/vision/ppocr";

function tensor(data: Float32Array, dims: readonly number[]) { return { data, dims } as never; }

describe("PP-OCR local processing", () => {
  it("rejects scans exceeding the recognition budget instead of truncating them", () => {
    expect(() => assertOcrRegionBudget(150)).not.toThrow();
    expect(() => assertOcrRegionBudget(151)).toThrow("budget exceeded");
  });
  it("creates normalized NCHW detector and dynamic-width recognizer tensors", () => {
    const image = { data: new Uint8ClampedArray(4 * 40 * 20).fill(255), width: 40, height: 20 } as ImageData;
    expect(preprocessPpOcrDetector(image).dims).toEqual([1, 3, 32, 64]);
    expect(preprocessPpOcrRecognizer(image, { x: 0, y: 0, width: 20, height: 10, score: 1 }).dims).toEqual([1, 3, 48, 96]);
  });

  it("extracts padded connected text regions from a DB score map", () => {
    const scores = new Float32Array(16); scores[5] = 0.9; scores[6] = 0.8; scores[9] = 0.7;
    const regions = decodePpOcrRegions(tensor(scores, [1, 1, 4, 4]), { width: 400, height: 200 });
    expect(regions[0]).toMatchObject({ x: 0, y: 0, width: 400, height: 200 });
    expect(regions[0]?.score).toBeCloseTo(0.8);
  });

  it("CTC-decodes distinct nonblank characters and averages their confidence", () => {
    const logits = new Float32Array([
      0.1, 0.9, 0.0,
      0.1, 0.8, 0.0,
      0.9, 0.0, 0.0,
      0.1, 0.0, 0.7
    ]);
    const decoded = decodePpOcrText(tensor(logits, [1, 4, 3]), ["A", "B"]);
    expect(decoded.text).toBe("AB");
    expect(decoded.confidence).toBeCloseTo(0.8);
  });
});
