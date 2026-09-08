import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backgroundSource = readFileSync(
  fileURLToPath(new URL("../src/background/index.ts", import.meta.url)),
  "utf8"
);
const sidepanelSource = readFileSync(
  fileURLToPath(new URL("../src/sidepanel/main.tsx", import.meta.url)),
  "utf8"
);
const protectedViewportSource = readFileSync(
  fileURLToPath(new URL("../src/vision/protected-viewport.ts", import.meta.url)),
  "utf8"
);

describe("captured-pixel egress canary", () => {
  it("routes a browser capture through the local canvas renderer before a receipt is created", () => {
    expect(protectedViewportSource).toMatch(/const rawCapture = await chrome\.tabs\.captureVisibleTab/);
    expect(protectedViewportSource).toMatch(/await detectVisualPrivacyOffscreen\(rawCapture\)/);
    expect(protectedViewportSource).toMatch(/const redactionPlan = \[\.\.\.inspection\.visualRedactions, \.\.\.visualRegions\]/);
    expect(protectedViewportSource).toMatch(/args: \[rawCapture, redactionPlan, viewport\]/);
    expect(protectedViewportSource).toMatch(/const residueScan = await detectVisualPrivacyOffscreen\(rendered\.result\);\s+assertNoVisualPrivacyResidue\(residueScan\.regions\)/);
    expect(protectedViewportSource).toMatch(/screenshot: await createSafeScreenshot\(rendered\.result, viewport\)/);
    expect(backgroundSource).toMatch(/createProtectedViewport\(message\.tabId\)/);
    expect(backgroundSource).not.toContain("protectedScreenshots");
  });

  it("regenerates a service-worker-owned receipt and context immediately before the reasoning request", () => {
    const requestStart = backgroundSource.indexOf("async function requestNextAction");
    expect(requestStart).toBeGreaterThan(-1);
    const requestSource = backgroundSource.slice(requestStart);
    expect(requestSource).not.toContain("rawCapture");
    expect(requestSource).toContain("nextActionDraftSchema.parse(payload)");
    expect(requestSource).toContain("collectCurrentRawContext(tabId)");
    expect(requestSource).toContain("createProtectedViewport(tabId, rawPage)");
    expect(requestSource).toContain("createOutboundSafeContext(rawPage)");
    expect(requestSource).toContain("screenshot: protectedViewport.screenshot");
    expect(requestSource).not.toContain("payload.screenshot");
    expect(requestSource).toContain("body: JSON.stringify(request)");
  });

  it("keeps the side-panel preview out of the proposal message payload", () => {
    const proposalMessageStart = sidepanelSource.indexOf('type: "NUDGE_REQUEST_NEXT_ACTION"');
    expect(proposalMessageStart).toBeGreaterThan(-1);
    const proposalMessage = sidepanelSource.slice(proposalMessageStart, sidepanelSource.indexOf("if (!response?.ok)", proposalMessageStart));
    expect(proposalMessage).toContain("tabId: state.page.tabId");
    expect(proposalMessage).not.toContain("screenshot:");
  });

  it("shows the service worker's fresh receipt with the resulting proposal", () => {
    expect(sidepanelSource).toContain("screenshot: protectedContext?.screenshot");
    expect(sidepanelSource).toContain("Exact locally redacted page view sent with this proposal");
    expect(sidepanelSource).toContain("Protected page view sent · receipt");
  });
});
