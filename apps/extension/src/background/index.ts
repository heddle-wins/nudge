import { canExportRedactedViewport, createOutboundSafeContext, createPrivacyInspection } from "@nudge/privacy-core";
import { collectRawPageContext, markElementPrivate } from "../content/collect";
import { renderRedactedViewport } from "../content/viewport";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function inspectTab(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "NUDGE_GET_SANITIZED_CONTEXT" });
    if (response?.ok) return response;
  } catch {
    // The page was open when Nudge was installed and has no content script yet.
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectRawPageContext
    });
    if (!injection?.result) throw new Error("Nudge could not read this page.");

    const inspection = createPrivacyInspection(injection.result);
    return { ok: true, context: createOutboundSafeContext(injection.result), redactionDetails: inspection.redactionDetails };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? `Nudge cannot inspect this page: ${error.message}`
        : "Nudge cannot inspect this page. Browser-internal pages are not supported."
    };
  }
}

async function collectInspection(tabId: number) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectRawPageContext
  });
  if (!injection?.result) throw new Error("Nudge could not read this page.");
  return {
    inspection: createPrivacyInspection(injection.result),
    viewport: injection.result.viewport,
    canExportViewport: canExportRedactedViewport(injection.result)
  };
}

async function createRedactedViewport(tabId: number) {
  const { inspection, viewport, canExportViewport } = await collectInspection(tabId);
  if (!canExportViewport) {
    throw new Error("Nudge will not export a visual preview for this page because all visible content cannot be safely redacted yet.");
  }
  const target = (await chrome.tabs.get(tabId));
  const rawCapture = await chrome.tabs.captureVisibleTab(target.windowId, { format: "png" });
  const [rendered] = await chrome.scripting.executeScript({
    target: { tabId },
    func: renderRedactedViewport,
    args: [rawCapture, inspection.visualRedactions, viewport ?? { width: target.width ?? 1, height: target.height ?? 1 }]
  });
  if (typeof rendered?.result !== "string") throw new Error("Nudge could not render the protected viewport.");
  return rendered.result;
}

async function markPrivate(tabId: number, elementId: string) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "NUDGE_MARK_ELEMENT_PRIVATE", elementId });
    if (response?.ok) return response;
  } catch {
    // Inject the local marker helper when the tab predates extension installation.
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: markElementPrivate,
    args: [elementId]
  });
  return { ok: injection?.result === true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_INSPECT_TAB" || typeof message.tabId !== "number") return;
  inspectTab(message.tabId).then(async (response) => {
    if (!response.ok || !message.includeViewport) return response;
    try {
      return { ...response, viewport: await createRedactedViewport(message.tabId) };
    } catch (error) {
      return {
        ...response,
        viewportError: error instanceof Error ? error.message : "The protected viewport preview is unavailable on this page."
      };
    }
  }).then(sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_MARK_PRIVATE" || typeof message.tabId !== "number" || typeof message.elementId !== "string") return;
  markPrivate(message.tabId, message.elementId).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not mark that element private." });
  });
  return true;
});
