import { canExportRedactedViewport, createOutboundSafeContext, createPrivacyInspection } from "@nudge/privacy-core";
import { nextActionRequestSchema, nextActionResponseSchema, type NextActionRequest, type NextActionResponse } from "@nudge/contracts";
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

function validateProposedAction(response: NextActionResponse, request: NextActionRequest) {
  const action = response.action;
  const targets = new Map(request.context.page.elements.map((element) => [element.id, element]));
  if (action.type === "navigate") throw new Error("Navigation is not enabled until Phase 4's local allowlist validator is ready.");

  if (action.type === "click" || action.type === "select" || action.type === "type") {
    if (!action.targetId) throw new Error("The reasoning server returned an action without a target.");
    const target = targets.get(action.targetId);
    if (!target || !target.state.visible || !target.state.enabled) throw new Error("The reasoning server returned a stale or unavailable target.");
    const validRoles = {
      click: ["button", "link", "checkbox", "radio"],
      select: ["select", "combobox"],
      type: ["textbox", "combobox"]
    } as const;
    if (!(validRoles[action.type] as readonly string[]).includes(target.role)) throw new Error("The reasoning server returned an incompatible target.");
  }

  if (action.type === "scroll" && !action.direction) throw new Error("The reasoning server returned an incomplete scroll action.");
  if (action.type === "select" && !action.optionLabel) throw new Error("The reasoning server returned an incomplete select action.");
  if ((action.type === "request_user_input" || action.type === "report_result") && !action.message) throw new Error("The reasoning server returned an incomplete user message.");
  if (!response.requiresConfirmation) throw new Error("Nudge requires confirmation for every Phase 3 proposal.");
}

function reasoningEndpoint(serverUrl: string) {
  const url = new URL(serverUrl);
  const isLocal = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (!isLocal && url.protocol !== "https:") throw new Error("The reasoning server must use HTTPS, except for local development.");
  if (url.username || url.password) throw new Error("The reasoning server URL must not contain credentials.");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/next-action`;
  return url.toString();
}

async function requestNextAction(payload: unknown, serverUrl: unknown) {
  const request = nextActionRequestSchema.parse(payload);
  if (typeof serverUrl !== "string") throw new Error("Set a reasoning server URL before requesting a proposal.");
  const response = await fetch(reasoningEndpoint(serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => undefined) as { detail?: unknown } | undefined;
    const detail = typeof errorBody?.detail === "string" ? errorBody.detail : undefined;
    throw new Error(detail ?? `The reasoning server rejected this sanitized request (${response.status}).`);
  }
  const result = nextActionResponseSchema.parse(await response.json());
  validateProposedAction(result, request);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_REQUEST_NEXT_ACTION") return;
  requestNextAction(message.payload, message.serverUrl).then(
    (proposal) => sendResponse({ ok: true, proposal }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not get a safe action proposal." })
  );
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_MARK_PRIVATE" || typeof message.tabId !== "number" || typeof message.elementId !== "string") return;
  markPrivate(message.tabId, message.elementId).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not mark that element private." });
  });
  return true;
});
