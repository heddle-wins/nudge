import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const content = readFileSync(resolve(import.meta.dirname, "../src/content/collect.ts"), "utf8");
const background = readFileSync(resolve(import.meta.dirname, "../src/background/index.ts"), "utf8");

describe("user-marked visual privacy canary", () => {
  it("stores drag rectangles locally and includes them in the local screenshot inspection", () => {
    expect(content).toContain('data-nudge-visual-regions');
    expect(content).toMatch(/export function beginVisualPrivacyMark\(\): Promise<boolean>/);
    expect(content).toMatch(/region\.width < 4 \|\| region\.height < 4/);
    expect(content).toMatch(/userMarkedVisualRegions: markedRegions/);
    expect(background).toMatch(/type: "NUDGE_BEGIN_VISUAL_PRIVACY_MARK"/);
  });

  it("records bounded opaque visual surfaces so they can be locally masked before export", () => {
    expect(content).toContain('const opaqueVisualRegions');
    expect(content).toContain('"img, canvas, embed, object, iframe, video"');
    expect(content).toContain('hasUninspectableVisualContent: false');
    expect(content).toContain('opaqueVisualRegions }');
  });
});
