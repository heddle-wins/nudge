import { describe, expect, it } from "vitest";
import { assertNoVisualPrivacyResidue } from "../src/vision/residue";

describe("visual redaction residue gate", () => {
  it("allows a locally verified protected image", () => {
    expect(() => assertNoVisualPrivacyResidue([])).not.toThrow();
  });

  it("blocks any remaining face or OCR-classified PII", () => {
    expect(() => assertNoVisualPrivacyResidue([
      { x: 1, y: 1, width: 1, height: 1, score: 0.9, kind: "government_id" }
    ])).toThrow("government_id");
  });
});
