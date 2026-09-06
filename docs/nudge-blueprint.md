# Nudge — Product and Engineering Blueprint

> **Product promise:** Nudge is the local-first browser agent where privacy is enforced before intelligence is invoked.

## 1. Purpose

Nudge is a browser-based AI agent for assisting and automating multi-step web workflows. It understands the current browser state, plans the next useful action, and executes only controlled browser actions.

Its differentiator is a mandatory, on-device privacy firewall. Raw page data and unredacted screenshots must never be sent to an external reasoning provider. Nudge removes or replaces sensitive information before the server-side reasoning step begins.

This project addresses SIH 2026 statement **SIH26171**, “On-device Visual Perception for Light-weight Browser Agents.” See [the captured statement](../problem-statement.md).

## 2. Product scope

### Nudge will do

- Accept a user task, for example: “Track my application and tell me its status.”
- Inspect the current browser tab using the DOM, accessibility tree, and visible viewport.
- Detect sensitive values locally and produce a sanitized browser context.
- Send only sanitized context to the Nudge reasoning server.
- Receive a constrained action plan such as click, type, select, scroll, or navigate.
- Validate every returned action locally and execute it when permitted by the user’s selected mode.
- Display the intended action, privacy redactions, and an audit history to the user.

### Nudge will not do

- Send an original screenshot, raw DOM snapshot, passwords, tokens, form values, or personal data to a server or LLM provider.
- Run an LLM locally in the extension.
- Permit an LLM to run arbitrary JavaScript, inject code, or directly control the browser without local validation.
- Circumvent CAPTCHAs, MFA, access controls, or a site’s authorization boundaries.
- Automatically submit an irreversible or high-impact action without explicit user confirmation.

## 3. Architecture at a glance

```text
User task
   |
   v
┌──────────────────── Browser extension: all privacy-critical work stays here ────────────────────┐
|  Content script             Local privacy & perception                 Extension controller       |
|  - DOM + accessibility      - Find sensitive DOM fields                - Task/session state       |
|  - Visible UI inventory     - Detect PII in visible text               - Consent mode             |
|  - Page state observer      - Mask values + regions                    - Policy enforcement       |
|  - Action executor          - Build sanitized page map                 - Action validation        |
└───────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                        | sanitized context only
                                        v
┌──────────────────────────────────── Nudge reasoning server ─────────────────────────────────────┐
|  API gateway -> task planner -> selected hosted reasoning API -> structured action response       |
|  No raw page data is logged or retained.                                                          |
└───────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                        | action schema only
                                        v
                          Extension validates, then proposes or executes action
```

## 4. System layers and ownership

| Layer | Runs where | Responsibility | May access raw page data? |
| --- | --- | --- | --- |
| Extension UI | Browser | Task input, consent, privacy explanation, audit view | Yes, locally |
| Content script | Browser tab | Read permitted DOM/a11y state, derive stable element IDs, execute actions | Yes, locally |
| Privacy and perception engine | Browser | Classify sensitive data, redact it, construct safe context | Yes, locally |
| Extension controller/service worker | Browser | Coordinate components, enforce policy, make approved network calls | Only locally |
| Nudge reasoning server | Our backend | Build prompts, orchestrate model call, validate response schema | Sanitized data only |
| Hosted LLM/VLM provider | External API | Reason over sanitized task context | Sanitized data only |

## 5. Local privacy and perception engine

This is the defining component of Nudge. It is deterministic and runs entirely in the extension. We are **not using an open-source/open-weight model for redaction**, and we are not sending inputs to a model to decide whether they are sensitive.

### Inputs

- DOM nodes and attributes available to the extension
- Accessibility tree semantics: role, accessible name, label, placeholder, and state
- Visible text and form metadata
- Optional viewport image, processed only in the browser

### Detection strategy (local only)

| Signal | Examples | Action |
| --- | --- | --- |
| Native field semantics | `input[type=password]`, `autocomplete=cc-number` | Never export value; mask region/value |
| Field labels and names | Aadhaar, PAN, email, phone, address, account number, DOB | Classify as sensitive; replace value |
| Pattern rules | email, phone, OTP, card, account, ID formats | Replace matched text with typed placeholders |
| Browser/session secrets | password, cookie-like token, authorization value | Exclude completely |
| User-marked selectors | A user flags an element or area as private | Permanently redact for that session |
| Visual regions | Face or sensitive screen region identified locally | Mask before any screenshot export |

### Sanitization rules

- Preserve UI structure and interaction capability, not private values.
- Use typed placeholders such as `[EMAIL_REDACTED]`, `[PHONE_REDACTED]`, and `[PASSWORD_REDACTED]`; this retains enough meaning for reasoning.
- Strip attributes that can leak data, including `value`, private `data-*` attributes, session tokens, and hidden fields.
- Do not transmit page HTML, cookies, browser storage, request headers, or full network logs.
- When visual context is needed, produce a redacted canvas/image locally. Never upload the original image first.
- If Nudge cannot confidently sanitize a source, block its transmission and ask the user to continue with a safer context.

### Why DOM/a11y first

DOM and accessibility information is lighter, more precise, and more explainable than screenshot-only automation. Local visual analysis supplements it for canvas-heavy interfaces, PDFs, image-based UIs, and cases where structure alone is insufficient. This hybrid approach supports the statement’s on-device visual-perception requirement without placing full language-model inference in the browser.

## 6. Reasoning-server design

The reasoning server is intentionally stateless by default. It receives a task and a sanitized page representation, asks a hosted reasoning model for the next action, validates the result, and returns it to the extension.

### Model policy

- No LLM runs locally.
- A hosted model API is used for reasoning. The provider is replaceable behind one server-side adapter.
- For SIH compatibility, prefer a hosted open-weight model endpoint for the judged build. The architecture may support OpenAI-compatible or other commercial APIs for development, but it must not depend on any single vendor.
- The server must never receive raw screenshots or raw page content; provider choice does not weaken the client-side privacy boundary.

### Server responsibilities

1. Authenticate the extension session.
2. Accept the sanitized context contract only.
3. Build a minimal, task-focused prompt.
4. Request a strictly structured next action from the model.
5. Schema-validate the response and reject invalid/unsafe actions.
6. Return the action, rationale, confidence, and confirmation requirement.
7. Avoid persistence; retain only opt-in, redacted diagnostic metadata.

## 7. Data contracts

The extension must use stable, opaque IDs for interactable page elements. The model receives IDs, never CSS selectors or arbitrary DOM paths it could use as an execution primitive.

### Extension to server: sanitized context

```json
{
  "schemaVersion": "1.0",
  "task": "Find the application status",
  "page": {
    "urlOrigin": "https://example.gov.in",
    "title": "Application Tracking",
    "elements": [
      {
        "id": "el_8e42",
        "role": "button",
        "name": "Track application",
        "state": { "enabled": true, "visible": true }
      },
      {
        "id": "el_1ba9",
        "role": "textbox",
        "name": "Application number",
        "value": "[ID_REDACTED]",
        "state": { "enabled": true, "visible": true }
      }
    ],
    "redactions": {
      "count": 1,
      "types": ["government_id"]
    }
  }
}
```

### Server to extension: constrained action

```json
{
  "schemaVersion": "1.0",
  "action": {
    "type": "click",
    "targetId": "el_8e42"
  },
  "rationale": "This opens the application tracking flow.",
  "confidence": 0.92,
  "requiresConfirmation": false
}
```

Allowed initial action types:

- `click`
- `scroll`
- `select`
- `type` — only after local policy and consent validation
- `navigate` — only to an allowlisted or user-visible URL
- `request_user_input`
- `report_result`

No action response may contain JavaScript, CSS selectors, shell commands, or executable code.

## 8. Local policy engine

The extension is the final authority. A model response is a proposal, not a command.

| Situation | Extension behavior |
| --- | --- |
| Target ID is absent or stale | Reject and request a new plan |
| Target is hidden/disabled | Reject and request a new plan |
| `type` would enter sensitive data | Ask user for explicit confirmation; do not expose value to server |
| Submit, payment, deletion, account/security change | Require confirmation |
| CAPTCHA, OTP, or MFA | Pause and ask the user to complete it manually |
| Context cannot be safely sanitized | Block server request |
| Unexpected navigation/domain change | Pause and request approval |

### User automation modes

1. **Suggest:** Nudge explains the next step; the user performs it.
2. **Confirm:** Nudge proposes each action; the user approves it.
3. **Trusted flow:** Nudge acts automatically only for low-risk, pre-approved actions; high-impact actions still require confirmation.

The hackathon demonstrator should default to **Confirm** mode.

## 9. Proposed technology stack

| Area | Choice | Reason |
| --- | --- | --- |
| Extension | TypeScript, Manifest V3 | Modern Chrome extension platform and type safety |
| Extension UI | React, Tailwind CSS | Fast, clear control panel and demo-ready interface |
| Extension build | Vite + CRXJS (or equivalent MV3 build setup) | Simple development and packaging |
| DOM/a11y processing | Browser DOM APIs, `MutationObserver`, accessibility attributes | Fast local UI understanding |
| Redaction | TypeScript rules, regex, Canvas/OffscreenCanvas | Fully local and explainable masking |
| Local visual processing | Browser-native APIs plus lightweight in-browser techniques when needed | Preserve local-first visual context without a local LLM |
| Backend | FastAPI + Python | Clear request validation and AI-provider integration |
| API contract | Pydantic + JSON Schema | Enforces the sanitized-context and action-response contracts |
| Model connection | Provider adapter using an OpenAI-compatible interface | Enables provider/model substitution |
| Database | PostgreSQL only for opt-in redacted audit events | Avoids collecting browser content |
| Deployment | Docker Compose | Repeatable local demo and deployment |
| Testing | Vitest, Playwright, pytest | Extension, browser-flow, and API coverage |

## 10. MVP demonstration

Demonstrate a realistic public-service workflow such as an application-status portal or a service-request form.

The demo must visibly show:

1. User enters a task in Nudge.
2. Extension builds an on-device page inventory.
3. Privacy panel identifies and masks an ID, email, phone number, address, password, or face.
4. A “sanitized context sent” preview proves that the raw value is absent.
5. Server returns a structured next action.
6. Nudge displays and/or executes the validated action.
7. The flow finishes with a result and redacted audit trail.

## 11. Delivery roadmap

### Phase 0 — Completed

- [x] Capture the SIH problem statement.
- [x] Define the product promise and system boundaries.
- [x] Define architecture, privacy policy, model policy, contracts, stack, and MVP.

### Phase 1 — Extension foundation

- [x] Create TypeScript Manifest V3 extension scaffold.
- [x] Add side-panel UI for local inspection and sanitized-context preview.
- [x] Add content script and service-worker communication.
- [x] Implement visible-element inventory with stable element IDs.

**Exit criterion:** Nudge can list visible buttons, inputs, links, and page title from a test page.

### Phase 2 — Local privacy firewall

- [x] Implement field-semantic, label, user-marked, and regex-based PII detection.
- [x] Implement DOM sanitization and typed placeholders.
- [x] Implement local redacted viewport/canvas export.
- [x] Add privacy preview: live local page versus outbound-safe representation.
- [x] Block unsafe outbound payloads with automated tests.

**Exit criterion:** Tests prove that passwords, emails, phones, IDs, and user-marked values cannot appear in an outbound payload.

### Phase 3 — Reasoning server

- [x] Create FastAPI server with `POST /v1/next-action`.
- [x] Add schema validation for incoming sanitized context.
- [x] Add provider adapter and environment-based provider configuration.
- [x] Restrict the model to the action schema.
- [x] Validate outgoing action responses.

The local default is a deterministic mock provider, so the complete API flow can be tested without a key. On the VPS, set `NUDGE_PROVIDER=fastrouter` and provide `FASTROUTER_API_KEY`; the first configured model is `openai/gpt-5-mini`. The key exists only in `apps/api/.env` on the server and is never available to the extension.

**Exit criterion:** A fixture context consistently yields a schema-valid action without raw data being logged.

### Phase 4 — Safe action execution

- [x] Implement action resolver for click, scroll, select, and report-result.
- [x] Add confirmation handling and high-impact action policy.
- [x] Implement stale-target, navigation, and MFA/CAPTCHA failure paths.
- [x] Add in-extension audit timeline.

The extension re-resolves every target from the current local page immediately after the user presses **Confirm and execute**. It executes only low-risk clicks, scrolls, standard selects, and local report results. It never types a provider-supplied value or automatically submits a form. Authentication, credential, payment, destructive, external-navigation, stale-target, MFA, and CAPTCHA paths pause locally and are recorded as a data-minimized audit outcome.

**Exit criterion:** The extension completes a controlled low-risk action after confirmation and safely pauses on restricted steps.

### Phase 5 — SIH demo hardening

- [x] Build the public-service workflow demonstrator.
- [x] Add user-approved local typing that never reaches the reasoning server.
- [x] Add controlled fake-PII fixtures and a reproducible measurement protocol.
- [x] Prepare the privacy-boundary slide content and fallback-recording shot list.
- [ ] Package extension and Dockerized server for reproducible judging.

The non-deployment demo kit is in [phase-five-demo.md](phase-five-demo.md). It includes the controlled SevaSetu portal, precise presenter steps, fixture evidence, measurement commands, and a recording shot list. A team member must still capture the final video on the selected demonstration machine; it must use only the fictional portal data.

## 12. Definition of done

Nudge is ready for demonstration only when all statements below are true:

- A working extension processes a real browser flow.
- Sensitive information is redacted in the browser before the network request.
- The outbound context preview contains no raw test PII.
- A hosted reasoning API returns only a schema-valid action.
- The extension rejects arbitrary code and invalid/stale actions.
- High-impact actions require consent.
- The product visibly explains its redactions and decisions.
- The stack can be run from documented configuration without committing API keys.

## 13. Contributor guardrails

Every contributor and agent must preserve these rules:

1. **Privacy precedes reasoning.** Build or change the sanitizer before adding new outbound context.
2. **The extension is the enforcement point.** The server or model is never trusted to protect private data or authorize actions.
3. **Use schemas at every boundary.** Do not add untyped payloads or free-form execution instructions.
4. **Default to no retention.** Do not log screenshots, raw DOM, form values, prompts, or responses containing user content.
5. **No secrets in the repository.** Use local environment variables and committed example files only.
6. **Test privacy regressions.** Any new context field needs a test proving sensitive variants are masked or excluded.
7. **Keep demos consent-driven.** Do not automate irreversible actions in the default demonstration path.

## 14. Open decisions to resolve before implementation

- Select the first hosted open-weight reasoning endpoint for the SIH build.
- Define the exact first demo portal or create a controlled mock public-service portal.
- Decide whether the extension uses a side panel, popup, or both as its primary UI.
- Define the supported PII classes and their India-specific validation patterns.
- Agree on the trusted-flow allowlist and confirmation thresholds.
