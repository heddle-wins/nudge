import { createOutboundSafeContext, createPrivacyInspection, type RawPageContext } from "@nudge/privacy-core";
import {
  executionRequestSchema,
  executionResultSchema,
  nextActionDraftSchema,
  nextActionRequestSchema,
  nextActionResponseSchema,
  sanitizedPageContextSchema,
  type ExecutionResult,
  type NextActionRequest,
  type NextActionResponse,
  type PiiKind,
  type SanitizedPageContext
} from "@nudge/contracts";
import { beginVisualPrivacyMark, collectRawPageContext, markElementPrivate } from "../content/collect";
import { executeApprovedAction } from "../content/execute";
import { evaluateExecutionPolicy } from "../execution-policy";
import { browserSupportsWebGpu } from "../vision/runtime";
import { detectVisualPrivacyOffscreen } from "../vision/offscreen-client";
import { createProtectedViewport } from "../vision/protected-viewport";

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
    return {
      ok: true,
      context: createOutboundSafeContext(injection.result),
      redactionDetails: inspection.redactionDetails,
      visualRedactionCount: inspection.visualRedactions.length,
      visualRedactionTypes: [...new Set(inspection.visualRedactions.map((region) => region.kind))] satisfies PiiKind[]
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? `Nudge cannot inspect this page: ${error.message}`
        : "Nudge cannot inspect this page. Browser-internal pages are not supported."
    };
  }
}

async function collectCurrentRawContext(tabId: number): Promise<RawPageContext> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectRawPageContext
  });
  if (!injection?.result) throw new Error("Nudge could not read this page.");
  return injection.result;
}

// This receiver is compiled only by the controlled fixture build. It exercises
// the real service-worker/offscreen path with Chrome's normal message lifetime;
// production builds expose no fixture message or debug API.
if (import.meta.env.MODE === "fixture") {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "NUDGE_FIXTURE_DETECT_VISUAL_PRIVACY" || typeof message.screenshot !== "string") return;
    detectVisualPrivacyOffscreen(message.screenshot).then(
      (scan) => sendResponse({ ok: true, scan }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not complete local visual privacy detection." })
    );
    return true;
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "NUDGE_FIXTURE_CREATE_PROTECTED_VIEWPORT" || typeof message.tabId !== "number") return;
    createProtectedViewport(message.tabId).then(
      // This redacted receipt is fixture-only and is never compiled into the
      // production worker. The runner checks its pixels in memory and writes
      // only aggregate proof counts to its ignored evidence artifact.
      (result) => sendResponse({ ok: true, screenshot: result.screenshot, redactionPlan: result.redactionPlan, visualRegionCount: result.visualRegions.length }),
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Nudge could not create the protected fixture viewport." })
    );
    return true;
  });
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

async function startVisualPrivacyMark(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "NUDGE_BEGIN_VISUAL_PRIVACY_MARK" });
    if (response?.ok) return response;
  } catch {
    // Inject the same local selector when the tab predates extension installation.
  }
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: beginVisualPrivacyMark });
  return { ok: injection?.result === true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_INSPECT_TAB" || typeof message.tabId !== "number") return;
  inspectTab(message.tabId).then(async (response) => {
    if (!response.ok || !message.includeViewport) return response;
    try {
      const protectedViewport = await createProtectedViewport(message.tabId);
      return {
        ...response,
        screenshot: protectedViewport.screenshot,
        visualRedactionCount: (typeof response.visualRedactionCount === "number" ? response.visualRedactionCount : 0) + protectedViewport.visualRegions.length,
        visualRedactionTypes: [...new Set([
          ...(Array.isArray(response.visualRedactionTypes) ? response.visualRedactionTypes : []),
          ...protectedViewport.visualRegions.map((region) => region.kind)
        ])] satisfies PiiKind[],
        visualScan: protectedViewport.visualScan
      };
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
  if (message?.type !== "NUDGE_BEGIN_VISUAL_PRIVACY_MARK" || typeof message.tabId !== "number") return;
  startVisualPrivacyMark(message.tabId).then(sendResponse).catch(() => sendResponse({ ok: false }));
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

type ActionReinspection =
  | { ok: true; context: SanitizedPageContext; expectedTarget?: SanitizedPageContext["page"]["elements"][number] }
  | { ok: false; result: ExecutionResult };

/** Re-collect local semantics at confirmation time; proposal-time context is never enough to execute. */
async function reinspectActionContext(tabId: number, proposal: NextActionResponse, proposalContext: SanitizedPageContext): Promise<ActionReinspection> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: collectRawPageContext });
  if (!injection?.result) return { ok: false, result: { status: "blocked", outcome: "stale_target", message: "Nudge could not re-inspect this page. Inspect again before continuing." } };
  const context = createOutboundSafeContext(injection.result);
  if (context.page.urlOrigin !== proposalContext.page.urlOrigin) {
    return { ok: false, result: { status: "blocked", outcome: "page_changed", message: "The page changed after the proposal. Inspect again before continuing." } };
  }
  if (!proposal.action.targetId) return { ok: true, context };
  const proposedTarget = proposalContext.page.elements.find((element) => element.id === proposal.action.targetId);
  const freshTarget = context.page.elements.find((element) => element.id === proposal.action.targetId);
  if (!proposedTarget || !freshTarget || !freshTarget.state.visible || !freshTarget.state.enabled || freshTarget.role !== proposedTarget.role || freshTarget.name !== proposedTarget.name) {
    return { ok: false, result: { status: "blocked", outcome: "stale_target", message: "The proposed control changed after the proposal. Inspect again before continuing." } };
  }
  return { ok: true, context, expectedTarget: freshTarget };
}

async function executeAction(tabId: number, rawProposal: unknown, rawContext: unknown, rawLocalValue: unknown) {
  const proposal = nextActionResponseSchema.parse(rawProposal);
  const context = sanitizedPageContextSchema.parse(rawContext) as SanitizedPageContext;
  if (!proposal.requiresConfirmation) throw new Error("Nudge requires an explicit confirmation before execution.");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("Nudge could not verify the active page before execution.");
  const expectedPageOrigin = new URL(tab.url).origin;
  if (expectedPageOrigin !== context.page.urlOrigin) throw new Error("The page changed after the proposal. Inspect again before continuing.");

  const reinspection = await reinspectActionContext(tabId, proposal, context);
  const localValue = proposal.action.type === "type" && typeof rawLocalValue === "string" ? rawLocalValue : undefined;
  const result: ExecutionResult = !reinspection.ok
    ? reinspection.result
    : await (async () => {
      const request = executionRequestSchema.parse({ action: proposal.action, expectedPageOrigin, ...(reinspection.expectedTarget ? { expectedTarget: reinspection.expectedTarget } : {}), ...(localValue ? { localValue } : {}) });
      const policy = evaluateExecutionPolicy(request, reinspection.context);
      return policy.allowed
        ? dispatchApprovedAction(tabId, request)
        : { status: "blocked" as const, outcome: policy.outcome, message: policy.message };
    })();
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

async function requestNextAction(payload: unknown, serverUrl: unknown, tabId: unknown) {
  const draft = nextActionDraftSchema.parse(payload);
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) throw new Error("Nudge requires the inspected browser tab before requesting a proposal.");
  // The side panel is never an authority for page context or screenshots. Build
  // both anew here, immediately before egress, so the preview, request body,
  // and proposal all refer to the same locally inspected page state.
  const rawPage = await collectCurrentRawContext(tabId);
  const context = createOutboundSafeContext(rawPage);
  const inspection = createPrivacyInspection(rawPage);
  const protectedViewport = await createProtectedViewport(tabId, rawPage);
  const visualMaskTypes = [...new Set(protectedViewport.redactionPlan.map((region) => region.kind))] satisfies PiiKind[];
  const request = nextActionRequestSchema.parse({
    task: draft.task,
    context,
    redactionManifest: {
      count: context.page.redactions.count,
      types: [...new Set([...context.page.redactions.types, ...visualMaskTypes])],
      visualMaskCount: protectedViewport.redactionPlan.length,
      renderer: "local-canvas-dom-v1"
    },
    screenshot: protectedViewport.screenshot
  });
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
  return {
    proposal: result,
    protectedContext: {
      context,
      redactionDetails: inspection.redactionDetails,
      visualRedactionCount: protectedViewport.redactionPlan.length,
      visualRedactionTypes: visualMaskTypes,
      visualScan: protectedViewport.visualScan,
      screenshot: protectedViewport.screenshot
    }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_REQUEST_NEXT_ACTION" || typeof message.tabId !== "number") return;
  requestNextAction(message.payload, message.serverUrl, message.tabId).then(
    ({ proposal, protectedContext }) => sendResponse({ ok: true, proposal, protectedContext }),
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
  if (message?.type !== "NUDGE_GET_VISION_RUNTIME") return;
  sendResponse({ ok: true, preferredBackend: browserSupportsWebGpu() ? "webgpu" : "wasm" });
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
