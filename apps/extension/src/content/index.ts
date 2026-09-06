import { createOutboundSafeContext, createPrivacyInspection } from "@nudge/privacy-core";
import { collectRawPageContext, markElementPrivate } from "./collect";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_GET_SANITIZED_CONTEXT") return;

  try {
    const raw = collectRawPageContext();
    const inspection = createPrivacyInspection(raw);
    sendResponse({ ok: true, context: createOutboundSafeContext(raw), redactionDetails: inspection.redactionDetails });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to inspect this page." });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_MARK_ELEMENT_PRIVATE" || typeof message.elementId !== "string") return;
  sendResponse({ ok: markElementPrivate(message.elementId) });
});
