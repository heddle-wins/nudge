import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExecutionResult, NextActionResponse, PiiKind, SafeScreenshot, SanitizedPageContext } from "@nudge/contracts";
import type { RedactionDetail } from "@nudge/privacy-core";
import "./styles.css";
import { renderRedactedViewport } from "../content/viewport";
import { proveRenderedFixturePixels } from "../vision/pixel-proof";

if (import.meta.env.MODE === "fixture") {
  Object.defineProperty(globalThis, "__nudgeFixtureRender", { value: renderRedactedViewport });
  Object.defineProperty(globalThis, "__nudgeFixturePixelProof", { value: proveRenderedFixturePixels });
}

type PageIdentity = { tabId: number; title: string; origin: string; hostname: string; faviconUrl: string };
type ReadyView = { status: "ready"; context: SanitizedPageContext; redactionDetails: RedactionDetail[]; visualRedactionCount: number; visualRedactionTypes: PiiKind[]; visualScan?: { scanMs: number; modelLoadMs: number; residueScanMs: number; backends: Array<"webgpu" | "wasm"> }; screenshot?: SafeScreenshot; viewportError?: string; page: PageIdentity };
type UnsupportedView = { status: "error"; label: string };
type ViewState = { status: "idle" | "loading" } | UnsupportedView | ReadyView;
type ConversationItem =
  | { id: string; role: "assistant"; kind: "text" | "loading" | "error"; text: string }
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "proposal"; proposal: NextActionResponse; screenshot?: SafeScreenshot };
type AuditEntry = { id: string; at: string; action: string; targetId?: string; status: ExecutionResult["status"]; outcome: ExecutionResult["outcome"] };

const LOCAL_SERVER = "http://127.0.0.1:8000";

function App() {
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [openPrivacyPanel, setOpenPrivacyPanel] = useState<"redactions" | "controls" | null>(null);
  const [draft, setDraft] = useState("");
  const [serverUrl, setServerUrl] = useState(LOCAL_SERVER);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const requestSerial = useRef(0);

  const loadAudit = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ type: "NUDGE_GET_AUDIT" });
    if (response?.ok && Array.isArray(response.entries)) setAudit(response.entries as AuditEntry[]);
  }, []);

  const inspectTab = useCallback(async (knownTab?: chrome.tabs.Tab) => {
    const serial = ++requestSerial.current;
    setState({ status: "loading" });
    try {
      const tab = knownTab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (!tab?.id || !tab.url) throw new Error("No active browser tab was found.");
      const response = await chrome.runtime.sendMessage({ type: "NUDGE_INSPECT_TAB", tabId: tab.id, includeViewport: true });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge cannot inspect this page.");
      if (serial !== requestSerial.current) return;
      const context = response.context as SanitizedPageContext;
      const origin = context.page.urlOrigin;
      const page: PageIdentity = { tabId: tab.id, title: context.page.title || tab.title || "Untitled page", origin, hostname: safeHostname(origin), faviconUrl: tab.favIconUrl ?? "" };
      setState({
        status: "ready", context, page,
        redactionDetails: Array.isArray(response.redactionDetails) ? response.redactionDetails as RedactionDetail[] : [],
        visualRedactionCount: typeof response.visualRedactionCount === "number" ? response.visualRedactionCount : 0,
        visualRedactionTypes: Array.isArray(response.visualRedactionTypes) ? response.visualRedactionTypes as PiiKind[] : [],
        visualScan: validVisualScan(response.visualScan),
        screenshot: response.screenshot as SafeScreenshot | undefined,
        viewportError: typeof response.viewportError === "string" ? response.viewportError : undefined
      });
      setOpenPrivacyPanel(null);
      setConversation([]);
    } catch {
      if (serial !== requestSerial.current) return;
      // Browser-owned pages cannot be inspected. Keep that state in the composer
      // instead of adding an alarming conversation message.
      setState({ status: "error", label: "This page isn’t available to Nudge" });
      setOpenPrivacyPanel(null);
      setConversation([]);
    }
  }, []);

  useEffect(() => {
    chrome.storage.local.get({ nudgeReasoningServerUrl: LOCAL_SERVER }).then((stored) => {
      if (typeof stored.nudgeReasoningServerUrl === "string") setServerUrl(stored.nudgeReasoningServerUrl);
    });
    void loadAudit();
    void inspectTab();
    const onActivated = () => { void inspectTab(); };
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (changeInfo.status === "complete" || Boolean(changeInfo.url))) void inspectTab(tab);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => { chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); };
  }, [inspectTab, loadAudit]);

  async function markPrivate(elementId: string) {
    if (state.status !== "ready") return;
    const response = await chrome.runtime.sendMessage({ type: "NUDGE_MARK_PRIVATE", tabId: state.page.tabId, elementId });
    if (response?.ok) await inspectTab();
  }

  async function markVisualPrivate() {
    if (state.status !== "ready") return;
    const response = await chrome.runtime.sendMessage({ type: "NUDGE_BEGIN_VISUAL_PRIVACY_MARK", tabId: state.page.tabId });
    if (response?.ok) await inspectTab();
  }

  async function sendTask(event: React.FormEvent) {
    event.preventDefault();
    if (state.status !== "ready" || !draft.trim() || !serverUrl.trim()) return;
    const task = draft.trim();
    const loadingId = crypto.randomUUID();
    setDraft("");
    setConversation((items) => [...items, { id: crypto.randomUUID(), role: "user", kind: "text", text: task }, { id: loadingId, role: "assistant", kind: "loading", text: "Reviewing the protected page context…" }]);
    try {
      await chrome.storage.local.set({ nudgeReasoningServerUrl: serverUrl.trim() });
      const response = await chrome.runtime.sendMessage({ type: "NUDGE_REQUEST_NEXT_ACTION", tabId: state.page.tabId, serverUrl: serverUrl.trim(), payload: { task } });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge could not get a safe action proposal.");
      const proposal = response.proposal as NextActionResponse;
      const protectedContext = response.protectedContext as Partial<ReadyView> | undefined;
      // Show the actual new receipt returned by the service worker, rather than
      // the earlier inspection preview. This is the exact image sent with this proposal.
      if (protectedContext?.context && protectedContext.screenshot) {
        setState((current) => current.status === "ready" && current.page.tabId === state.page.tabId
          ? {
              ...current,
              context: protectedContext.context as SanitizedPageContext,
              redactionDetails: Array.isArray(protectedContext.redactionDetails) ? protectedContext.redactionDetails as RedactionDetail[] : current.redactionDetails,
              visualRedactionCount: typeof protectedContext.visualRedactionCount === "number" ? protectedContext.visualRedactionCount : current.visualRedactionCount,
              visualRedactionTypes: Array.isArray(protectedContext.visualRedactionTypes) ? protectedContext.visualRedactionTypes as PiiKind[] : current.visualRedactionTypes,
              visualScan: validVisualScan(protectedContext.visualScan) ?? current.visualScan,
              screenshot: protectedContext.screenshot as SafeScreenshot,
              viewportError: undefined
            }
          : current);
      }
      setConversation((items) => items.map((item) => item.id === loadingId ? {
        id: loadingId,
        role: "assistant",
        kind: "proposal",
        proposal,
        screenshot: protectedContext?.screenshot as SafeScreenshot | undefined
      } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nudge could not get a safe action proposal.";
      setConversation((items) => items.map((item) => item.id === loadingId ? { id: loadingId, role: "assistant", kind: "error", text: message } : item));
    }
  }

  async function executeProposal(proposal: NextActionResponse, localValue?: string) {
    if (state.status !== "ready") throw new Error("The active page changed. Ask again for a proposal.");
    const response = await chrome.runtime.sendMessage({ type: "NUDGE_EXECUTE_ACTION", tabId: state.page.tabId, proposal, context: state.context, ...(localValue ? { localValue } : {}) });
    if (!response?.ok) throw new Error(response?.error ?? "Nudge could not complete the approved action.");
    await loadAudit();
    return response.result as ExecutionResult;
  }

  const isReady = state.status === "ready";
  return <main className="app-shell">
    {openPrivacyPanel && <button className="privacy-backdrop" type="button" aria-label="Close privacy panel" onClick={() => setOpenPrivacyPanel(null)} />}
    {state.status === "ready" && <PrivacySummary view={state} audit={audit} serverUrl={serverUrl} onServerUrlChange={setServerUrl} openPanel={openPrivacyPanel} onOpenPanelChange={setOpenPrivacyPanel} onMarkPrivate={markPrivate} onMarkVisualPrivate={markVisualPrivate} />}
    <section className="conversation-viewport">
      <section className="conversation" aria-live="polite" aria-label="Nudge conversation">
        {state.status === "loading" && <AssistantBubble kind="loading">Inspecting this page locally…</AssistantBubble>}
        {state.status === "idle" && <AssistantBubble>Opening the active page’s local context…</AssistantBubble>}
        {conversation.map((item) => item.kind === "proposal" ? <ProposalBubble key={item.id} proposal={item.proposal} screenshot={item.screenshot} onExecute={executeProposal} /> : item.role === "user" ? <div className="message user" key={item.id}>{item.text}</div> : <AssistantBubble key={item.id} kind={item.kind === "error" ? "error" : item.kind === "loading" ? "loading" : undefined}>{item.text}</AssistantBubble>)}
      </section>
    </section>
    <form className="composer" onSubmit={(event) => void sendTask(event)}>
      {isReady && <div className="composer-context"><span className="composer-favicon">{state.page.faviconUrl ? <img src={state.page.faviconUrl} alt="" /> : state.page.hostname.slice(0, 1).toUpperCase()}</span><span>Nudging “{shortTitle(state.page.title)}”</span></div>}
      {state.status === "error" && <div className="composer-context unavailable-context"><PcNoEntry /><span>{state.label}</span></div>}
      <div className="composer-input">
        <textarea aria-label="Describe what you want to do" value={draft} maxLength={1_000} rows={1} disabled={!isReady} placeholder={isReady ? "Ask Nudge about this page" : "Waiting for a supported page"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <button className="send" type="submit" disabled={!isReady || !draft.trim()} aria-label="Send task">
          <span className="send-arrow" aria-hidden="true">
            {/* Iconoir NavArrowUp */}
            <svg className="send-arrow-tip" viewBox="0 0 24 24" fill="none"><path d="M6 15 12 9 18 15" /></svg>
            {/* Iconoir ArrowUp */}
            <svg className="send-arrow-full" viewBox="0 0 24 24" fill="none"><path d="M12 21V3m0 0 8.5 8.5M12 3l-8.5 8.5" /></svg>
          </span>
        </button>
      </div>
    </form>
  </main>;
}

function PrivacySummary({ view, audit, serverUrl, onServerUrlChange, openPanel, onOpenPanelChange, onMarkPrivate, onMarkVisualPrivate }: { view: ReadyView; audit: AuditEntry[]; serverUrl: string; onServerUrlChange: (value: string) => void; openPanel: "redactions" | "controls" | null; onOpenPanelChange: (panel: "redactions" | "controls" | null) => void; onMarkPrivate: (id: string) => Promise<void>; onMarkVisualPrivate: () => Promise<void> }) {
  const privateFields = view.context.page.elements.filter((element) => element.role === "textbox" || element.role === "combobox").slice(0, 20);
  const redactions = view.context.page.redactions.count + view.visualRedactionCount;
  return <section className="privacy-summary" aria-label="Privacy controls">
    <details className="redaction-details" open={openPanel === "redactions"}>
      <summary onClick={(event) => { event.preventDefault(); onOpenPanelChange(openPanel === "redactions" ? null : "redactions"); }}><ShieldCheck /><span>{redactions} {redactions === 1 ? "item" : "items"} redacted</span><NavArrowDown /></summary>
      <div className="redaction-details-panel">
        {view.redactionDetails.length > 0 ? <ul>{view.redactionDetails.map((detail, index) => <li key={`${detail.kind}-${detail.location}-${index}`}><strong>{piiLabel(detail.kind)}</strong><span>{detail.location}</span></li>)}</ul> : <p>No DOM-sensitive values were found on this page.</p>}
        {view.visualRedactionCount > 0 && <p className="visual-scan-summary">{view.visualRedactionCount} visual mask{view.visualRedactionCount === 1 ? "" : "s"}: {view.visualRedactionTypes.map(piiLabel).join(", ") || "local privacy detection"}.</p>}
        {view.visualScan && <p className="visual-scan-summary">Scanned locally in {Math.round(view.visualScan.scanMs)} ms via {view.visualScan.backends.join(" + ")} (model load {Math.round(view.visualScan.modelLoadMs)} ms); redacted pixels were checked again in {Math.round(view.visualScan.residueScanMs)} ms.</p>}
        {view.screenshot && <><img className="protected-preview" src={view.screenshot.dataUrl} alt="Exact locally redacted page view that will be sent to the reasoning server" /><p className="visual-scan-summary">Exact outgoing view · receipt {view.screenshot.sha256.slice(0, 12)}…</p></>}
        {view.viewportError && <p className="drawer-error">{view.viewportError}</p>}
        <details className="nested-details"><summary>View sanitized context</summary><pre>{JSON.stringify(view.context, null, 2)}</pre></details>
      </div>
    </details>
    <details className="privacy-controls" open={openPanel === "controls"}>
      <summary onClick={(event) => { event.preventDefault(); onOpenPanelChange(openPanel === "controls" ? null : "controls"); }}><ControlSlider />Privacy controls</summary>
      <div className="privacy-controls-panel">
        <p>Protected values stay in this browser.</p>
        <button className="mark-visual-area" type="button" onClick={() => void onMarkVisualPrivate()}>Mark an area on this page private</button>
        {privateFields.length > 0 ? <div className="element-list">{privateFields.map((element) => <button type="button" key={element.id} onClick={() => void onMarkPrivate(element.id)}>Mark “{element.name}” private</button>)}</div> : <p>No editable fields are available to mark private.</p>}
        <details className="nested-details"><summary>Reasoning connection</summary><label>Reasoning server URL<input value={serverUrl} inputMode="url" onChange={(event) => onServerUrlChange(event.target.value)} /></label><p>The endpoint is saved locally when you send a task. HTTPS is required except for localhost development.</p></details>
        <details className="nested-details"><summary>Local audit ({audit.length})</summary>{audit.length > 0 ? <ul className="audit-list">{audit.slice(0, 8).map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll("_", " ")}</strong><span>{entry.status === "completed" ? "Completed" : "Paused"} · {entry.outcome.replaceAll("_", " ")}</span></li>)}</ul> : <p>No actions have been recorded on this device.</p>}</details>
      </div>
    </details>
  </section>;
}

function AssistantBubble({ children, kind }: { children: React.ReactNode; kind?: "error" | "loading" }) { return <div className={`message assistant${kind ? ` ${kind}` : ""}`}><span className="assistant-mark">N</span><p>{children}</p></div>; }

function ProposalBubble({ proposal, screenshot, onExecute }: { proposal: NextActionResponse; screenshot?: SafeScreenshot; onExecute: (proposal: NextActionResponse, localValue?: string) => Promise<ExecutionResult> }) {
  const [localValue, setLocalValue] = useState(""); const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle"); const [result, setResult] = useState<ExecutionResult | null>(null);
  const needsLocalText = proposal.action.type === "type"; const target = proposal.action.targetId ? ` · ${proposal.action.targetId}` : "";
  async function confirm() { setStatus("working"); try { const next = await onExecute(proposal, needsLocalText ? localValue : undefined); setResult(next); setStatus("done"); } catch (error) { setResult({ status: "blocked", outcome: "unsupported_action", message: error instanceof Error ? error.message : "Nudge could not complete the action." }); setStatus("error"); } }
  return <div className="proposal-bubble">{screenshot && <div className="proposal-receipt"><img className="protected-preview" src={screenshot.dataUrl} alt="Exact locally redacted page view sent with this proposal" /><small>Protected page view sent · receipt {screenshot.sha256.slice(0, 12)}…</small></div>}<div className="proposal-label">Safe next step</div><strong>{proposal.action.type.replaceAll("_", " ")}{target}</strong><p>{proposal.rationale}</p><small>{Math.round(proposal.confidence * 100)}% confidence · Local confirmation required</small>
    {needsLocalText && <label className="local-entry">Text to enter locally<input value={localValue} maxLength={500} autoComplete="off" placeholder="Enter it yourself" onChange={(event) => setLocalValue(event.target.value)} /><span>Never sent to the server or saved in the audit.</span></label>}
    <button type="button" className="confirm" disabled={status !== "idle" || (needsLocalText && !localValue.trim())} onClick={() => void confirm()}>{status === "working" ? "Re-checking page…" : needsLocalText ? "Confirm local text and enter" : "Confirm and execute"}</button>
    {result && <p className={`execution-result ${result.status === "completed" ? "success" : "error"}`}>{result.message}</p>}</div>;
}

function piiLabel(kind: RedactionDetail["kind"]): string { return ({ face: "Face", password: "Password", email: "Email", phone: "Phone", government_id: "Government ID", payment: "Payment detail", account_number: "Account number", address: "Address", date_of_birth: "Date of birth", token: "Token", user_marked: "Marked private" } as const)[kind]; }
function validVisualScan(value: unknown): ReadyView["visualScan"] {
  if (!value || typeof value !== "object") return undefined;
  const scan = value as { scanMs?: unknown; modelLoadMs?: unknown; residueScanMs?: unknown; backends?: unknown };
  if (!Number.isFinite(scan.scanMs) || !Number.isFinite(scan.modelLoadMs) || !Number.isFinite(scan.residueScanMs) || !Array.isArray(scan.backends) || !scan.backends.every((backend) => backend === "webgpu" || backend === "wasm")) return undefined;
  return { scanMs: scan.scanMs as number, modelLoadMs: scan.modelLoadMs as number, residueScanMs: scan.residueScanMs as number, backends: scan.backends as Array<"webgpu" | "wasm"> };
}
function safeHostname(origin: string) { try { return new URL(origin).hostname; } catch { return origin; } }
function shortTitle(title: string) { return title.length > 31 ? `${title.slice(0, 30).trimEnd()}…` : title; }
function ControlSlider() { return <svg className="control-slider-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{/* Iconoir control-slider — https://iconoir.com/icon/control-slider */}<path d="M6.75469 17.2828 5.32612 7.28284C5.154 6.07798 6.08892 5 7.30602 5H10.694C11.9111 5 12.846 6.07797 12.6739 7.28284L11.2453 17.2828C11.1046 18.2681 10.2607 19 9.26541 19H8.73459C7.73929 19 6.89545 18.2681 6.75469 17.2828Z" stroke="currentColor" strokeWidth="1.5" /><path d="M2 12H6M22 12H12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>; }
function ShieldCheck() { return <svg className="shield-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{/* Iconoir shield-check — https://iconoir.com/icon/shield-check */}<path d="m8.5 11.5 3 3 5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M5 18 3.13036 4.91253C3.05646 4.39524 3.39389 3.91247 3.90398 3.79912L11.5661 2.09641C11.8519 2.03291 12.1481 2.03291 12.4339 2.09641L20.096 3.79912C20.6061 3.91247 20.9435 4.39524 20.8696 4.91252L19 18C18.9293 18.495 18.5 21.5 12 21.5 5.5 21.5 5.07071 18.495 5 18Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>; }
function NavArrowDown() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{/* Iconoir nav-arrow-down — https://iconoir.com/icon/nav-arrow-down */}<path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function PcNoEntry() { return <svg className="unavailable-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{/* Iconoir pc-no-entry — https://iconoir.com/icon/pc-no-entry */}<path d="M7 22L17 22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 17V4C2 2.89543 2.89543 2 4 2H20C21.1046 2 22 2.89543 22 4V17C22 18.1046 21.1046 19 20 19H4C2.89543 19 2 18.1046 2 17Z" stroke="currentColor" /><path d="M14.8566 7.7C14.1306 6.95946 13.119 6.5 12 6.5C9.79086 6.5 8 8.29086 8 10.5C8 11.5902 8.43613 12.5785 9.14343 13.3M14.8566 7.7C15.5639 8.4215 16 9.40982 16 10.5C16 12.7091 14.2091 14.5 12 14.5C10.881 14.5 9.8694 14.0405 9.14343 13.3M14.8566 7.7L9.14343 13.3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
