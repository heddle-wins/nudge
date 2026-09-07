import { describe, expect, it } from "vitest";
import { evaluateRedaction } from "../src/vision/evaluation";

describe("redaction fixture evaluation", () => {
  it("reports complete coverage while separating intentional padding from sensitive pixels", () => {
    const metrics = evaluateRedaction(
      { width: 100, height: 100 },
      [{ x: 10, y: 10, width: 20, height: 10, kind: "government_id" }],
      [{ x: 6, y: 6, width: 28, height: 18 }]
    );
    expect(metrics).toMatchObject({ expectedRegions: 1, protectedRegions: 1, missedRegions: 0, matchedMasks: 1, falsePositiveMasks: 0, precision: 1, recall: 1, coverage: 1 });
    expect(metrics.overRedactedPixels).toBe(304);
    expect(metrics.byKind.government_id).toEqual({ expected: 1, protected: 1, missed: 0 });
  });

  it("counts a one-pixel residual leak as a missed protected region", () => {
    const metrics = evaluateRedaction(
      { width: 100, height: 100 },
      [{ x: 10, y: 10, width: 10, height: 10, kind: "email" }],
      [{ x: 10, y: 10, width: 9, height: 10 }]
    );
    expect(metrics).toMatchObject({ protectedRegions: 0, missedRegions: 1, residualSensitivePixels: 10, coverage: 0.9 });
  });

  it("clips invalid boxes and rejects invalid evaluation dimensions", () => {
    expect(evaluateRedaction({ width: 20, height: 20 }, [{ x: -5, y: 0, width: 10, height: 10, kind: "face" }], [{ x: 0, y: 0, width: 5, height: 10 }]).coverage).toBe(1);
    expect(() => evaluateRedaction({ width: 0, height: 20 }, [], [])).toThrow("positive screenshot dimensions");
  });

  it("separates off-target masks from strict region recall", () => {
    const metrics = evaluateRedaction(
      { width: 100, height: 100 },
      [{ x: 10, y: 10, width: 10, height: 10, kind: "phone" }],
      [{ x: 10, y: 10, width: 9, height: 10 }, { x: 70, y: 70, width: 8, height: 8 }]
    );
    expect(metrics).toMatchObject({ matchedMasks: 1, falsePositiveMasks: 1, precision: 0.5, recall: 0, missedRegions: 1 });
  });
});
