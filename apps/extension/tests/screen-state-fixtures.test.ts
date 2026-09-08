import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { screenStateValues } from "@nudge/contracts";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/screen-state");
const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8")) as {
  schemaVersion: number;
  fixtures: Array<{ id: string; asset: string; expectedState: string }>;
};

describe("controlled screen-state fixtures", () => {
  it("covers every approved state exactly once with a local full-screen asset", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtures.map((fixture) => fixture.expectedState).sort()).toEqual([...screenStateValues].sort());
    expect(new Set(manifest.fixtures.map((fixture) => fixture.id)).size).toBe(manifest.fixtures.length);
    for (const fixture of manifest.fixtures) {
      expect(fixture.asset).not.toContain("/");
      expect(existsSync(resolve(fixtureRoot, fixture.asset))).toBe(true);
    }
  });
});
