import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backgroundSource = readFileSync(
  fileURLToPath(new URL("../src/background/index.ts", import.meta.url)),
  "utf8"
);

describe("captured-pixel egress canary", () => {
  it("routes a browser capture through the local canvas renderer before a receipt is created", () => {
    expect(backgroundSource).toMatch(/const rawCapture = await chrome\.tabs\.captureVisibleTab/);
    expect(backgroundSource).toMatch(/const detectedFaces = await detectFaces\(rawCapture/);
    expect(backgroundSource).toMatch(/args: \[rawCapture, \[\.\.\.inspection\.visualRedactions, \.\.\.faceRegions\]/);
    expect(backgroundSource).toMatch(/screenshot: await createSafeScreenshot\(rendered\.result/);
  });

  it("does not serialize the named raw browser capture in the reasoning request", () => {
    const requestStart = backgroundSource.indexOf("async function requestNextAction");
    expect(requestStart).toBeGreaterThan(-1);
    const requestSource = backgroundSource.slice(requestStart);
    expect(requestSource).not.toContain("rawCapture");
    expect(requestSource).toContain("body: JSON.stringify(request)");
  });
});
