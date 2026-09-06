import { createSanitizedPageContext } from "@nudge/privacy-core";
import { collectRawPageContext } from "./collect";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_GET_SANITIZED_CONTEXT") return;

  try {
    sendResponse({ ok: true, context: createSanitizedPageContext(collectRawPageContext()) });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to inspect this page." });
  }
});
