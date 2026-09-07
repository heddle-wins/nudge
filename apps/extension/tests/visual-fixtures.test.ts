import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/visual-privacy");
const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
  schemaVersion: number;
  fixtures: Array<{ id: string; asset: string; surface: string; dimensions: { width: number; height: number }; expected: Array<{ kind: string; x: number; y: number; width: number; height: number }> }>;
};

describe("frozen visual privacy fixture corpus", () => {
  it("covers image, canvas-like, profile, Indian-ID, multilingual, and adversarial cases", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtures.map((fixture) => fixture.surface)).toEqual(expect.arrayContaining(["dom", "screenshot_image", "canvas_like", "profile_image", "unknown"]));
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual(expect.arrayContaining(["screenshot-indian-identifiers", "adversarial-devenagari-spaced-id"]));
  });

  it("keeps every labelled box inside a real, frozen source asset", () => {
    for (const fixture of manifest.fixtures) {
      const source = readFileSync(resolve(fixtureRoot, fixture.asset), "utf8");
      expect(source).toMatch(/<(svg|html)/);
      if (fixture.surface === "unknown") expect(fixture.expected).toEqual([]);
      else expect(fixture.expected.length).toBeGreaterThan(0);
      for (const region of fixture.expected) {
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.x + region.width).toBeLessThanOrEqual(fixture.dimensions.width);
        expect(region.y + region.height).toBeLessThanOrEqual(fixture.dimensions.height);
      }
    }
  });
});
