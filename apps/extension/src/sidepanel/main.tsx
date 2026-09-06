import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SanitizedPageContext } from "@nudge/contracts";
import type { RedactionDetail } from "@nudge/privacy-core";
import "./styles.css";

type ViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: SanitizedPageContext; redactionDetails: RedactionDetail[]; viewport?: string; viewportError?: string };

function App() {
  const [state, setState] = useState<ViewState>({ status: "idle" });

  async function inspectCurrentTab() {
    setState({ status: "loading" });
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

  return (
    <main>
      <header>
        <p className="eyebrow">Nudge · Phase 2</p>
        <h1>Private context, locally.</h1>
        <p className="subtitle">Inspect the active page and preview the sanitized context. Nothing is sent anywhere.</p>
      </header>

      <button className="primary" type="button" onClick={inspectCurrentTab} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Inspecting locally…" : "Inspect active page"}
      </button>

      {state.status === "error" && <p className="notice error">{state.message}</p>}
      {state.status === "ready" && <ContextPreview context={state.context} redactionDetails={state.redactionDetails} viewport={state.viewport} viewportError={state.viewportError} onMarkPrivate={inspectCurrentTab} />}
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
        Privacy firewall active. No server or model is connected; this is the exact safe shape reserved for a future outbound request.
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
