import { createSanitizedPageContext } from "@nudge/privacy-core";
import { collectRawPageContext } from "../content/collect";

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

    return { ok: true, context: createSanitizedPageContext(injection.result) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? `Nudge cannot inspect this page: ${error.message}`
        : "Nudge cannot inspect this page. Browser-internal pages are not supported."
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_INSPECT_TAB" || typeof message.tabId !== "number") return;
  inspectTab(message.tabId).then(sendResponse);
  return true;
});
