import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExecutionResult, NextActionResponse, SanitizedPageContext } from "@nudge/contracts";
import type { RedactionDetail } from "@nudge/privacy-core";
import "./styles.css";

type ViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: SanitizedPageContext; redactionDetails: RedactionDetail[]; viewport?: string; viewportError?: string };

type ProposalState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; proposal: NextActionResponse };

type ExecutionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ExecutionResult };

type AuditEntry = {
  id: string;
  at: string;
  action: string;
  targetId?: string;
  status: ExecutionResult["status"];
  outcome: ExecutionResult["outcome"];
};

function App() {
  const [state, setState] = useState<ViewState>({ status: "idle" });
  const [proposalState, setProposalState] = useState<ProposalState>({ status: "idle" });
  const [executionState, setExecutionState] = useState<ExecutionState>({ status: "idle" });
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [task, setTask] = useState("Find the next step for this task");
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8000");

  useEffect(() => {
    chrome.storage.local.get({ nudgeReasoningServerUrl: "http://127.0.0.1:8000" }).then((stored) => {
      if (typeof stored.nudgeReasoningServerUrl === "string") setServerUrl(stored.nudgeReasoningServerUrl);
    });
  }, []);

  async function loadAudit() {
    const response = await chrome.runtime.sendMessage({ type: "NUDGE_GET_AUDIT" });
    if (response?.ok && Array.isArray(response.entries)) setAudit(response.entries as AuditEntry[]);
  }

  useEffect(() => { void loadAudit(); }, []);

  async function inspectCurrentTab() {
    setState({ status: "loading" });
    setProposalState({ status: "idle" });
    setExecutionState({ status: "idle" });
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab.id) throw new Error("No active browser tab was found.");

      const response = await chrome.runtime.sendMessage({ type: "NUDGE_INSPECT_TAB", tabId: tab.id, includeViewport: true });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge cannot inspect this page.");

      setState({
        status: "ready",
        context: response.context as SanitizedPageContext,
        redactionDetails: Array.isArray(response.redactionDetails) ? response.redactionDetails as RedactionDetail[] : [],
        viewport: typeof response.viewport === "string" ? response.viewport : undefined,
        viewportError: typeof response.viewportError === "string" ? response.viewportError : undefined
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Nudge cannot inspect this page."
      });
    }
  }

  async function requestProposal(context: SanitizedPageContext) {
    setProposalState({ status: "loading" });
    setExecutionState({ status: "idle" });
    try {
      await chrome.storage.local.set({ nudgeReasoningServerUrl: serverUrl.trim() });
      const response = await chrome.runtime.sendMessage({
        type: "NUDGE_REQUEST_NEXT_ACTION",
        serverUrl: serverUrl.trim(),
        payload: { task, context }
      });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge could not get a safe action proposal.");
      setProposalState({ status: "ready", proposal: response.proposal as NextActionResponse });
    } catch (error) {
      setProposalState({ status: "error", message: error instanceof Error ? error.message : "Nudge could not get a safe action proposal." });
    }
  }

  async function executeProposal(context: SanitizedPageContext, proposal: NextActionResponse, localValue?: string) {
    setExecutionState({ status: "loading" });
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab.id) throw new Error("No active browser tab was found.");
      const response = await chrome.runtime.sendMessage({ type: "NUDGE_EXECUTE_ACTION", tabId: tab.id, proposal, context, ...(localValue ? { localValue } : {}) });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge could not complete the approved action.");
      setExecutionState({ status: "ready", result: response.result as ExecutionResult });
      await loadAudit();
    } catch (error) {
      setExecutionState({ status: "error", message: error instanceof Error ? error.message : "Nudge could not complete the approved action." });
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Nudge · Phase 5 demo</p>
        <h1>Private context, locally.</h1>
        <p className="subtitle">Inspect locally, then ask your reasoning server for one safe next-action proposal.</p>
      </header>

      <button className="primary" type="button" onClick={inspectCurrentTab} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Inspecting locally…" : "Inspect active page"}
      </button>

      {state.status === "error" && <p className="notice error">{state.message}</p>}
      {state.status === "ready" && <>
        <ContextPreview context={state.context} redactionDetails={state.redactionDetails} viewport={state.viewport} viewportError={state.viewportError} onMarkPrivate={inspectCurrentTab} />
        <ReasoningControl
          context={state.context}
          task={task}
          serverUrl={serverUrl}
          proposalState={proposalState}
          onTaskChange={setTask}
          onServerUrlChange={setServerUrl}
          onRequest={requestProposal}
          executionState={executionState}
          onExecute={executeProposal}
        />
        <AuditTimeline audit={audit} />
      </>}
      {state.status === "idle" && <p className="notice">Nudge reads the active tab only after you choose to inspect it.</p>}
    </main>
  );
}

function ContextPreview({
  context,
  redactionDetails,
  viewport,
  viewportError,
  onMarkPrivate
}: {
  context: SanitizedPageContext;
  redactionDetails: RedactionDetail[];
  viewport?: string;
  viewportError?: string;
  onMarkPrivate: () => Promise<void>;
}) {
  const { page } = context;

  async function markPrivate(elementId: string) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab.id) return;
    const response = await chrome.runtime.sendMessage({ type: "NUDGE_MARK_PRIVATE", tabId: tab.id, elementId });
    if (response?.ok) await onMarkPrivate();
  }

  return (
    <section className="preview" aria-live="polite">
      <div className="preview-heading">
        <div>
          <p className="eyebrow">Outbound-safe context</p>
          <h2>{page.title || "Untitled page"}</h2>
          <p>{page.urlOrigin}</p>
        </div>
        <span className="badge">{page.redactions.count} redactions</span>
      </div>

      <p className="privacy-note">
        Privacy firewall active. Only this sanitized shape is eligible to leave the browser; the live page, raw DOM, and private values stay local.
      </p>

      {redactionDetails.length > 0 && <section className="redaction-summary" aria-label="Protected items">
        <p className="eyebrow">Protected items</p>
        <ul>
          {redactionDetails.map((detail, index) => (
            <li key={`${detail.kind}-${detail.location}-${index}`}>
              <strong>{piiLabel(detail.kind)}</strong><span>{detail.location}</span>
            </li>
          ))}
        </ul>
        <p className="control-copy">The original value is intentionally never shown here.</p>
      </section>}

      <section className="viewport-preview" aria-label="Protected viewport preview">
        <div>
          <p className="eyebrow">Protected viewport</p>
          <p className="viewport-copy">The live page remains on your device. Dark blocks are applied locally before this visual can leave the browser.</p>
        </div>
        {viewport && <img src={viewport} alt="Locally redacted active-page viewport" />}
        {viewportError && <p className="notice error">{viewportError}</p>}
      </section>

      <details>
        <summary>Privacy controls</summary>
        <p className="control-copy">Mark an element private to replace its value and mask its visible region for this tab session.</p>
        <div className="element-list">
          {page.elements.filter((element) => element.role === "textbox" || element.role === "combobox").slice(0, 20).map((element) => (
            <button className="secondary" type="button" key={element.id} onClick={() => void markPrivate(element.id)}>
              Mark “{element.name}” private
            </button>
          ))}
        </div>
      </details>

      <details>
        <summary>View sanitized context</summary>
        <pre>{JSON.stringify(context, null, 2)}</pre>
      </details>
    </section>
  );
}

function ReasoningControl({
  context,
  task,
  serverUrl,
  proposalState,
  onTaskChange,
  onServerUrlChange,
  onRequest,
  executionState,
  onExecute
}: {
  context: SanitizedPageContext;
  task: string;
  serverUrl: string;
  proposalState: ProposalState;
  onTaskChange: (value: string) => void;
  onServerUrlChange: (value: string) => void;
  onRequest: (context: SanitizedPageContext) => Promise<void>;
  executionState: ExecutionState;
  onExecute: (context: SanitizedPageContext, proposal: NextActionResponse, localValue?: string) => Promise<void>;
}) {
  return (
    <section className="reasoning" aria-live="polite">
      <p className="eyebrow">Reasoning server</p>
      <label>
        <span>Task</span>
        <textarea value={task} maxLength={1_000} onChange={(event) => onTaskChange(event.target.value)} />
      </label>
      <label>
        <span>Server URL</span>
        <input value={serverUrl} inputMode="url" onChange={(event) => onServerUrlChange(event.target.value)} />
      </label>
      <p className="control-copy">Nudge sends the task and the outbound-safe context above—never a screenshot, raw DOM, cookies, or original redacted value.</p>
      <button className="primary" type="button" onClick={() => void onRequest(context)} disabled={!task.trim() || !serverUrl.trim() || proposalState.status === "loading"}>
        {proposalState.status === "loading" ? "Requesting safe proposal…" : "Request next action"}
      </button>
      {proposalState.status === "error" && <p className="notice error">{proposalState.message}</p>}
      {proposalState.status === "ready" && <Proposal proposal={proposalState.proposal} executionState={executionState} onExecute={(localValue) => onExecute(context, proposalState.proposal, localValue)} />}
    </section>
  );
}

function Proposal({ proposal, executionState, onExecute }: { proposal: NextActionResponse; executionState: ExecutionState; onExecute: (localValue?: string) => Promise<void> }) {
  const [localValue, setLocalValue] = useState("");
  const target = proposal.action.targetId ? ` on ${proposal.action.targetId}` : "";
  const needsLocalText = proposal.action.type === "type";
  const canExecute = !needsLocalText || Boolean(localValue.trim());
  return <section className="proposal">
    <p className="eyebrow">Proposed action</p>
    <p className="proposal-action">{proposal.action.type.replaceAll("_", " ")}{target}</p>
    {proposal.action.message && !needsLocalText && <p>{proposal.action.message}</p>}
    <p className="control-copy">{proposal.rationale}</p>
    <p className="control-copy">Confidence {Math.round(proposal.confidence * 100)}% · Local confirmation required</p>
    <p className="notice">Nudge will re-check the live page locally before acting. It will pause for stale controls, MFA/CAPTCHA, sensitive fields, external navigation, and high-impact actions.</p>
    {needsLocalText && <label className="local-input">
      <span>Text to enter locally</span>
      <input value={localValue} maxLength={500} autoComplete="off" placeholder="Enter the exact text yourself" onChange={(event) => setLocalValue(event.target.value)} />
      <small>This value stays in Nudge. It is not sent to the server or kept in the audit trail.</small>
    </label>}
    <button className="primary confirm" type="button" onClick={() => void onExecute(needsLocalText ? localValue : undefined)} disabled={!canExecute || executionState.status === "loading" || executionState.status === "ready"}>
      {executionState.status === "loading" ? "Re-checking and executing…" : needsLocalText ? "Confirm local text and enter" : "Confirm and execute"}
    </button>
    {executionState.status === "error" && <p className="notice error">{executionState.message}</p>}
    {executionState.status === "ready" && <p className={`notice ${executionState.result.status === "completed" ? "success" : "error"}`}>{executionState.result.message}</p>}
  </section>;
}

function AuditTimeline({ audit }: { audit: AuditEntry[] }) {
  return <section className="audit" aria-label="Local action audit">
    <p className="eyebrow">Local audit</p>
    <p className="control-copy">Last 30 confirmed execution attempts. This device-only trail excludes page text, URLs, and form values.</p>
    {audit.length === 0 ? <p className="control-copy">No confirmed actions yet.</p> : <ol>
      {audit.slice(0, 8).map((entry) => <li key={entry.id}>
        <strong>{entry.action.replaceAll("_", " ")}</strong>
        <span>{entry.status === "completed" ? "Completed" : "Paused"} · {entry.outcome.replaceAll("_", " ")}</span>
      </li>)}
    </ol>}
  </section>;
}

function piiLabel(kind: RedactionDetail["kind"]): string {
  const labels: Record<RedactionDetail["kind"], string> = {
    password: "Password hidden",
    email: "Email address hidden",
    phone: "Phone number hidden",
    government_id: "Government ID hidden",
    payment: "Payment information hidden",
    account_number: "Account number hidden",
    address: "Address hidden",
    date_of_birth: "Date of birth hidden",
    token: "Token hidden",
    user_marked: "User-marked content hidden"
  };
  return labels[kind];
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
