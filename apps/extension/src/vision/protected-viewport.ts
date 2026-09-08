import { canExportRedactedViewport, createPrivacyInspection } from "@nudge/privacy-core";
import { collectRawPageContext } from "../content/collect";
import { renderRedactedViewport } from "../content/viewport";
import { createSafeScreenshot } from "../safe-screenshot";
import { detectVisualPrivacyOffscreen } from "./offscreen-client";
import { assertNoVisualPrivacyResidue } from "./residue";

/**
 * The sole local capability that turns a tab capture into an egress-eligible
 * receipt. Raw capture pixels are scoped to this function and never returned.
 */
export async function createProtectedViewport(tabId: number) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectRawPageContext
  });
  if (!injection?.result) throw new Error("Nudge could not read this page.");
  const rawPage = injection.result;
  if (!canExportRedactedViewport(rawPage)) {
    throw new Error("Nudge will not export a visual preview for this page because all visible content cannot be safely redacted yet.");
  }

  const inspection = createPrivacyInspection(rawPage);
  const target = await chrome.tabs.get(tabId);
  const rawCapture = await chrome.tabs.captureVisibleTab(target.windowId, { format: "png" });
  const visualScan = await detectVisualPrivacyOffscreen(rawCapture);
  const visualRegions = visualScan.regions.map((region) => ({ ...region, coordinateSpace: "image" as const }));
  const viewport = rawPage.viewport ?? { width: target.width ?? 1, height: target.height ?? 1 };
  const [rendered] = await chrome.scripting.executeScript({
    target: { tabId },
    func: renderRedactedViewport,
    args: [rawCapture, [...inspection.visualRedactions, ...visualRegions], viewport]
  });
  if (typeof rendered?.result !== "string") throw new Error("Nudge could not render the protected viewport.");

  const residueScan = await detectVisualPrivacyOffscreen(rendered.result);
  assertNoVisualPrivacyResidue(residueScan.regions);
  return {
    screenshot: await createSafeScreenshot(rendered.result, viewport),
    visualRegions,
    visualScan: {
      scanMs: visualScan.scanMs,
      modelLoadMs: visualScan.modelLoadMs,
      backends: visualScan.backends,
      residueScanMs: residueScan.scanMs
    }
  };
}
