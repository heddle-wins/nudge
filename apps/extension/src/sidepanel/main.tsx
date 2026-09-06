import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SanitizedPageContext } from "@nudge/contracts";
import "./styles.css";

type ViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: SanitizedPageContext };

function App() {
  const [state, setState] = useState<ViewState>({ status: "idle" });

  async function inspectCurrentTab() {
    setState({ status: "loading" });
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab.id) throw new Error("No active browser tab was found.");

      const response = await chrome.runtime.sendMessage({ type: "NUDGE_INSPECT_TAB", tabId: tab.id });
      if (!response?.ok) throw new Error(response?.error ?? "Nudge cannot inspect this page.");

      setState({ status: "ready", context: response.context as SanitizedPageContext });
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
        <p className="eyebrow">Nudge · Phase 1</p>
        <h1>Private context, locally.</h1>
        <p className="subtitle">Inspect the active page and preview the sanitized context. Nothing is sent anywhere.</p>
      </header>

      <button className="primary" type="button" onClick={inspectCurrentTab} disabled={state.status === "loading"}>
        {state.status === "loading" ? "Inspecting locally…" : "Inspect active page"}
      </button>

      {state.status === "error" && <p className="notice error">{state.message}</p>}
      {state.status === "ready" && <ContextPreview context={state.context} />}
      {state.status === "idle" && <p className="notice">Nudge reads the active tab only after you choose to inspect it.</p>}
    </main>
  );
}

function ContextPreview({ context }: { context: SanitizedPageContext }) {
  const { page } = context;
  return (
    <section className="preview" aria-live="polite">
      <div className="preview-heading">
        <div>
          <p className="eyebrow">Outbound-ready preview</p>
          <h2>{page.title || "Untitled page"}</h2>
          <p>{page.urlOrigin}</p>
        </div>
        <span className="badge">{page.redactions.count} redactions</span>
      </div>

      <p className="privacy-note">
        This is local-only. Server and model connections are intentionally not part of Phase 1.
      </p>

      <details>
        <summary>View sanitized context</summary>
        <pre>{JSON.stringify(context, null, 2)}</pre>
      </details>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
