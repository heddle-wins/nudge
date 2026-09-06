import { canExportRedactedViewport, createOutboundSafeContext, createPrivacyInspection } from "@nudge/privacy-core";
import {
  executionRequestSchema,
  executionResultSchema,
  nextActionRequestSchema,
  nextActionResponseSchema,
  sanitizedPageContextSchema,
  type ExecutionResult,
  type NextActionRequest,
  type NextActionResponse,
  type SanitizedPageContext
} from "@nudge/contracts";
import { collectRawPageContext, markElementPrivate } from "../content/collect";
import { executeApprovedAction } from "../content/execute";
import { renderRedactedViewport } from "../content/viewport";
import { evaluateExecutionPolicy } from "../execution-policy";

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
    return { ok: true, context: createOutboundSafeContext(injection.result), redactionDetails: inspection.redactionDetails, visualRedactionCount: inspection.visualRedactions.length };
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

type AuditEntry = {
  id: string;
  at: string;
  action: string;
  targetId?: string;
  status: ExecutionResult["status"];
  outcome: ExecutionResult["outcome"];
};

async function appendAudit(action: string, targetId: string | undefined, result: ExecutionResult): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    ...(targetId ? { targetId } : {}),
    status: result.status,
    outcome: result.outcome
  };
  const stored = await chrome.storage.local.get({ nudgeAuditTrail: [] });
  const existing = Array.isArray(stored.nudgeAuditTrail) ? stored.nudgeAuditTrail as AuditEntry[] : [];
  await chrome.storage.local.set({ nudgeAuditTrail: [entry, ...existing].slice(0, 30) });
  return entry;
}

async function dispatchApprovedAction(tabId: number, request: Parameters<typeof executeApprovedAction>[0]) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "NUDGE_EXECUTE_APPROVED_ACTION", request });
    if (response?.ok) return executionResultSchema.parse(response.result);
  } catch {
    // The page predates extension installation; inject the same local executor.
  }
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: executeApprovedAction, args: [request] });
  if (!injection?.result) throw new Error("Nudge could not complete the approved action.");
  return executionResultSchema.parse(injection.result);
}

async function executeAction(tabId: number, rawProposal: unknown, rawContext: unknown, rawLocalValue: unknown) {
  const proposal = nextActionResponseSchema.parse(rawProposal);
  const context = sanitizedPageContextSchema.parse(rawContext) as SanitizedPageContext;
  if (!proposal.requiresConfirmation) throw new Error("Nudge requires an explicit confirmation before execution.");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("Nudge could not verify the active page before execution.");
  const expectedPageOrigin = new URL(tab.url).origin;
  if (expectedPageOrigin !== context.page.urlOrigin) throw new Error("The page changed after the proposal. Inspect again before continuing.");

  const expectedTarget = proposal.action.targetId
    ? context.page.elements.find((element) => element.id === proposal.action.targetId)
    : undefined;
  const localValue = proposal.action.type === "type" && typeof rawLocalValue === "string" ? rawLocalValue : undefined;
  const request = executionRequestSchema.parse({ action: proposal.action, expectedPageOrigin, ...(expectedTarget ? { expectedTarget } : {}), ...(localValue ? { localValue } : {}) });
  const policy = evaluateExecutionPolicy(request, context);
  const result: ExecutionResult = policy.allowed
    ? await dispatchApprovedAction(tabId, request)
    : { status: "blocked", outcome: policy.outcome, message: policy.message };
  const audit = await appendAudit(proposal.action.type, proposal.action.targetId, result);
  return { result, audit };
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
  if (message?.type !== "NUDGE_EXECUTE_ACTION" || typeof message.tabId !== "number") return;
  executeAction(message.tabId, message.proposal, message.context, message.localValue).then(
    ({ result, audit }) => sendResponse({ ok: true, result, audit }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not complete the approved action." })
  );
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_GET_AUDIT") return;
  chrome.storage.local.get({ nudgeAuditTrail: [] }).then((stored) => {
    sendResponse({ ok: true, entries: Array.isArray(stored.nudgeAuditTrail) ? stored.nudgeAuditTrail : [] });
  });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_MARK_PRIVATE" || typeof message.tabId !== "number" || typeof message.elementId !== "string") return;
  markPrivate(message.tabId, message.elementId).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not mark that element private." });
  });
  return true;
});
