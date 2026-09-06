import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExecutionResult, NextActionResponse, SanitizedPageContext } from "@nudge/contracts";
import type { RedactionDetail } from "@nudge/privacy-core";
import "./styles.css";

type PageIdentity = { tabId: number; title: string; origin: string; hostname: string; faviconUrl: string };
type ReadyView = { status: "ready"; context: SanitizedPageContext; redactionDetails: RedactionDetail[]; visualRedactionCount: number; viewport?: string; viewportError?: string; page: PageIdentity };
type ViewState = { status: "idle" | "loading" } | { status: "error"; message: string } | ReadyView;
type ConversationItem =
  | { id: string; role: "assistant"; kind: "text" | "loading" | "error"; text: string }
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "proposal"; proposal: NextActionResponse };
type AuditEntry = { id: string; at: string; action: string; targetId?: string; status: ExecutionResult["status"]; outcome: ExecutionResult["outcome"] };

const LOCAL_SERVER = "http://127.0.0.1:8000";

function App() {
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
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
        viewport: typeof response.viewport === "string" ? response.viewport : undefined,
        viewportError: typeof response.viewportError === "string" ? response.viewportError : undefined
      });
      setConversation([]);
    } catch (error) {
      if (serial !== requestSerial.current) return;
      const message = error instanceof Error ? error.message : "Nudge cannot inspect this page.";
      setState({ status: "error", message });
      setConversation([{ id: crypto.randomUUID(), role: "assistant", kind: "error", text: message }]);
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

  async function sendTask(event: React.FormEvent) {
    event.preventDefault();
    if (state.status !== "ready" || !draft.trim() || !serverUrl.trim()) return;
    const task = draft.trim();
    const loadingId = crypto.randomUUID();
    setDraft("");
    setConversation((items) => [...items, { id: crypto.randomUUID(), role: "user", kind: "text", text: task }, { id: loadingId, role: "assistant", kind: "loading", text: "Reviewing the outbound-safe page context…" }]);
    try {
      await chrome.storage.local.set({ nudgeReasoningServerUrl: serverUrl.trim() });
      const response = await chrome.runtime.sendMessage({ type: "NUDGE_REQUEST_NEXT_ACTION", serverUrl: serverUrl.trim(), payload: { task, context: state.context } });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge could not get a safe action proposal.");
      const proposal = response.proposal as NextActionResponse;
      setConversation((items) => items.map((item) => item.id === loadingId ? { id: loadingId, role: "assistant", kind: "proposal", proposal } : item));
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
    <section className="conversation" aria-live="polite" aria-label="Nudge conversation">
      {state.status === "loading" && <AssistantBubble kind="loading">Inspecting this page locally…</AssistantBubble>}
      {state.status === "idle" && <AssistantBubble>Opening the active page’s local context…</AssistantBubble>}
      {conversation.map((item) => item.kind === "proposal" ? <ProposalBubble key={item.id} proposal={item.proposal} onExecute={executeProposal} /> : item.role === "user" ? <div className="message user" key={item.id}>{item.text}</div> : <AssistantBubble key={item.id} kind={item.kind === "error" ? "error" : item.kind === "loading" ? "loading" : undefined}>{item.text}</AssistantBubble>)}
    </section>
    <form className="composer" onSubmit={(event) => void sendTask(event)}>
      {isReady && <div className="composer-context"><span className="composer-favicon">{state.page.faviconUrl ? <img src={state.page.faviconUrl} alt="" /> : state.page.hostname.slice(0, 1).toUpperCase()}</span><span>Sharing “{shortTitle(state.page.title)}”</span></div>}
      <div className="composer-input">
        <textarea aria-label="Describe what you want to do" value={draft} maxLength={1_000} rows={1} disabled={!isReady} placeholder={isReady ? "Ask Nudge about this page" : "Waiting for a supported page"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <button className="send" type="submit" disabled={!isReady || !draft.trim()} aria-label="Send task">
          {/* Iconoir NavArrowUp — https://iconoir.com/icon/nav-arrow-up */}
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 15 12 9 18 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </form>
  </main>;
}

function PageContext({ view, serverUrl, onServerUrlChange, onMarkPrivate, audit }: { view: ReadyView; serverUrl: string; onServerUrlChange: (value: string) => void; onMarkPrivate: (id: string) => Promise<void>; audit: AuditEntry[] }) {
  const { context, page, redactionDetails, visualRedactionCount, viewport, viewportError } = view;
  return <section className="page-context">
    <div className="page-heading"><span className="site-mark">{page.faviconUrl ? <img src={page.faviconUrl} alt="" /> : <span aria-hidden="true">{page.hostname.slice(0, 1).toUpperCase()}</span>}</span><div><strong>{page.title}</strong><span>{page.hostname}</span></div><span className="context-dot" title="Active page context is local" /></div>
    <div className="context-meta"><span>{context.page.redactions.count} outbound redactions</span><span>{visualRedactionCount} visual masks</span></div>
    <details className="privacy-drawer"><summary>Privacy controls and local context</summary>
      <p className="drawer-note">Raw page content, cookies, screenshots, and original protected values stay in your browser.</p>
      {redactionDetails.length > 0 && <ul className="redaction-list">{redactionDetails.map((detail, index) => <li key={`${detail.kind}-${detail.location}-${index}`}><strong>{piiLabel(detail.kind)}</strong><span>{detail.location}</span></li>)}</ul>}
      <div className="element-list">{context.page.elements.filter((element) => element.role === "textbox" || element.role === "combobox").slice(0, 20).map((element) => <button type="button" key={element.id} onClick={() => void onMarkPrivate(element.id)}>Mark “{element.name}” private</button>)}</div>
      {viewport && <img className="viewport" src={viewport} alt="Locally redacted page viewport" />}{viewportError && <p className="drawer-error">{viewportError}</p>}
      <details className="nested-details"><summary>View sanitized context</summary><pre>{JSON.stringify(context, null, 2)}</pre></details>
      <details className="nested-details"><summary>Connection</summary><label>Reasoning server URL<input value={serverUrl} inputMode="url" onChange={(event) => onServerUrlChange(event.target.value)} /></label></details>
      <details className="nested-details"><summary>Local audit ({audit.length})</summary><ul className="audit-list">{audit.slice(0, 8).map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll("_", " ")}</strong><span>{entry.status === "completed" ? "Completed" : "Paused"} · {entry.outcome.replaceAll("_", " ")}</span></li>)}</ul></details>
    </details>
  </section>;
}

function AssistantBubble({ children, kind }: { children: React.ReactNode; kind?: "error" | "loading" }) { return <div className={`message assistant${kind ? ` ${kind}` : ""}`}><span className="assistant-mark">N</span><p>{children}</p></div>; }

function ProposalBubble({ proposal, onExecute }: { proposal: NextActionResponse; onExecute: (proposal: NextActionResponse, localValue?: string) => Promise<ExecutionResult> }) {
  const [localValue, setLocalValue] = useState(""); const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle"); const [result, setResult] = useState<ExecutionResult | null>(null);
  const needsLocalText = proposal.action.type === "type"; const target = proposal.action.targetId ? ` · ${proposal.action.targetId}` : "";
  async function confirm() { setStatus("working"); try { const next = await onExecute(proposal, needsLocalText ? localValue : undefined); setResult(next); setStatus("done"); } catch (error) { setResult({ status: "blocked", outcome: "unsupported_action", message: error instanceof Error ? error.message : "Nudge could not complete the action." }); setStatus("error"); } }
  return <div className="proposal-bubble"><div className="proposal-label">Safe next step</div><strong>{proposal.action.type.replaceAll("_", " ")}{target}</strong><p>{proposal.rationale}</p><small>{Math.round(proposal.confidence * 100)}% confidence · Local confirmation required</small>
    {needsLocalText && <label className="local-entry">Text to enter locally<input value={localValue} maxLength={500} autoComplete="off" placeholder="Enter it yourself" onChange={(event) => setLocalValue(event.target.value)} /><span>Never sent to the server or saved in the audit.</span></label>}
    <button type="button" className="confirm" disabled={status !== "idle" || (needsLocalText && !localValue.trim())} onClick={() => void confirm()}>{status === "working" ? "Re-checking page…" : needsLocalText ? "Confirm local text and enter" : "Confirm and execute"}</button>
    {result && <p className={`execution-result ${result.status === "completed" ? "success" : "error"}`}>{result.message}</p>}</div>;
}

function piiLabel(kind: RedactionDetail["kind"]): string { return ({ password: "Password", email: "Email", phone: "Phone", government_id: "Government ID", payment: "Payment detail", account_number: "Account number", address: "Address", date_of_birth: "Date of birth", token: "Token", user_marked: "Marked private" } as const)[kind]; }
function safeHostname(origin: string) { try { return new URL(origin).hostname; } catch { return origin; } }
function shortTitle(title: string) { return title.length > 31 ? `${title.slice(0, 30).trimEnd()}…` : title; }
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
