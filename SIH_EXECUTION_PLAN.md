# Nudge — SIH26171 Execution Plan

> **Outcome:** Nudge becomes a working privacy-preserving browser *vision* agent: it reads a browser screen locally, redacts sensitive visual data before any request, shows the user the exact protected screenshot that is sent, asks a server model for one safe next step, and executes only locally validated actions.

This is the implementation plan for SIH26171, **On-device Visual Perception for Light-weight Browser Agents**. It converts our problem-statement analysis and the review of 41 public competing repositories into an ordered build plan.

## 1. The one-sentence product

**Nudge helps with a browser task without giving the reasoning model the user's original screen, form values, face, or credentials.**

The model is useful, but it is never the privacy or browser-execution authority.

```text
User task
  -> capture visible tab locally
  -> local DOM + screenshot perception
  -> local PII/face redaction and verification
  -> show the exact protected screenshot in Nudge chat
  -> send only protected screenshot + safe page map to the server model
  -> receive one structured proposal
  -> local policy + user confirmation
  -> execute only an allowed action
```

## 2. The SIH requirement we must meet

The judging criteria are not a generic security checklist. They give marks for visual context, PII detection, redaction precision, browser resource use, and end-to-end latency. See [the captured brief](./problem-statement.md).

| Required capability | What it means for Nudge |
| --- | --- |
| Local vision | A real lightweight computer-vision model must run in the browser and evaluate the current screen. DOM-only inspection is insufficient. |
| Local privacy filter | Faces, password fields, and visual PII must be dynamically found and redacted before a network request. |
| Server integration | The server model receives anonymized visual context and returns a usable action. |
| End-to-end demo | A user sees the protected flow complete on a realistic browser task. |
| Measured trade-offs | We report accuracy, privacy detection, redaction quality, resources, and latency from reproducible tests. |

## 3. What Nudge has today

| Area | Status | Evidence / limitation |
| --- | --- | --- |
| Browser extension and side-panel chat | Working foundation | Task entry, chat-style proposals, local audit trail. |
| DOM/a11y page map | Working | Visible controls are mapped to opaque local IDs. |
| DOM PII sanitization | Working baseline | Field semantics, labels, user marks, and regex rules redact values. |
| Local screenshot mask renderer | Working baseline | Canvas can black out regions derived from DOM geometry. |
| Fail-closed screenshot decision | Working baseline | Images, canvas, iframes, and incomplete scans prevent visual export. Safe, but not useful visual perception. |
| Structured action contract | Working | Server action proposals are locally checked; arbitrary code is not executed. |
| Confirmation and high-risk blocking | Working | Submit, MFA/CAPTCHA, navigation, sensitive input, and high-impact actions pause. |
| Client-side CV model | **Missing** | No face model, screenshot OCR, screen-state model, or visual UI understanding runs locally. |
| Screenshot PII redaction | **Missing** | Text inside images/canvas/PDFs and profile photos cannot be safely handled. |
| Screenshot to VLM | Working baseline | The exact locally redacted PNG now has a typed receipt, SHA-256 integrity check, visible preview, and one server request path. It remains DOM-mask-only until OCR/face perception lands. |
| Multimodal reasoning provider | Working baseline | The OpenAI-compatible provider path sends the verified protected PNG as an image part. An explicit OpenAI adapter and open-weight Qwen adapter remain to do. |
| Measured SIH evaluation | **Missing** | No visual PII fixture corpus, precision/recall report, resource benchmark, or p50/p95 end-to-end report. |
| Firefox build and test | **Missing** | The current implementation is Chrome-oriented. |

## 4. The architecture we will build

### 4.1 Local-first data flow

| Layer | Runs where | Job | May access raw screenshot / PII? |
| --- | --- | --- | --- |
| Content collector | Browser content script | DOM/a11y inventory and local target IDs | Yes, locally |
| Capture coordinator | Extension background/service worker | Captures current visible tab after a user task or meaningful page change | Yes, locally |
| Vision worker | Offscreen document or worker | Runs local models and returns only boxes/classes | Yes, locally |
| Privacy fusion engine | Browser | Merges DOM, OCR, face, and user-marked regions | Yes, locally |
| Redaction renderer | Browser canvas | Produces a redacted image; discards raw image after processing | Yes, locally |
| Egress gate | Browser | The only code allowed to serialize and transmit a screenshot | **Only redacted output** |
| Reasoning server | Server | Calls VLM and validates a structured action | Sanitized page map + redacted image only |
| Action executor | Browser content script | Re-resolves a local target and applies local policy | Yes, locally |

### 4.2 Selected local perception stack

We are **not training our own ML model**. We will package and run pretrained lightweight models locally. The ML work is integration, preprocessing, postprocessing, evaluation, and privacy enforcement.

| Need | Selected approach | Why |
| --- | --- | --- |
| Runtime | `onnxruntime-web`: WebGPU first, WASM fallback | One browser-native runtime; preserves compatibility when WebGPU is unavailable. |
| Screenshot OCR | PP-OCR detection + recognition ONNX models | Finds text that DOM cannot see: screenshots, canvas UIs, images, and PDFs. |
| Face detection | YuNet ONNX face detector | Small model; runs in the same ONNX runtime; catches profile photos and visible faces. |
| Screen state | Quantized MobileViT-XXS (or an equally small screen-state model) | Explicitly demonstrates local ViT/equivalent vision: login, form, results, error, review/submit, dashboard. |
| PII classification | Deterministic Indian PII rules + local NER only if rules are ambiguous | Rules are explainable, fast, and reliable for IDs/patterns; NER improves names/addresses later. |
| UI structure | DOM/a11y first, OCR/vision second | DOM is cheaper and gives stable action targets. Vision fills its blind spots. |

**Do not start with a giant local VLM.** It would hurt latency, memory, package size, and reliability. PP-OCR + face detection + a compact screen-state model are enough to prove the local vision requirement and protect pixels before the server VLM reasons over them.

### 4.3 Redaction rules

| Source | Detect locally | Treatment |
| --- | --- | --- |
| Native form field | Password, OTP, card, email, phone, Aadhaar, PAN, bank/account/IFSC, address, DOB | Black out visual box; replace DOM value with typed placeholder. |
| DOM visible text | PII patterns and semantic labels | Mask matching text regions; preserve non-sensitive UI labels. |
| Screenshot OCR | PII embedded in images, canvas, PDF, screenshot-only UI | Black out detected text region with padding. |
| Face / profile image | Face detector boxes; avatar/profile semantics | Blur or black out the face. If detection is uncertain on a known avatar, mask the whole avatar. |
| User-marked area | User-selected element or screen rectangle | Always redact for the current session. |
| Unknown/uninspectable visual surface | Cross-origin iframe, unsupported canvas/PDF/image failure | Do **not** send a screenshot. Send safe DOM structure only, or ask the user to continue without visual reasoning. |

Privacy decisions are asymmetric: a false positive is acceptable; a leaked sensitive value is not. Every visual mask gets extra padding. When confidence is insufficient, Nudge removes visual context rather than sending the original screen.

### 4.4 The non-negotiable egress gate

The strongest competitive feature is not a redaction claim; it is proof that raw pixels cannot leave.

1. `captureVisibleTab()` returns a raw image only to local capture/redaction code.
2. Only `createSafeScreenshot()` may create an outbound image blob.
3. Only `sendReasoningRequest()` may perform the request.
4. It accepts a branded/opaque `SafeScreenshot`, not a raw `string`, `Blob`, or data URL.
5. Unit tests, static checks, and a runtime canary must fail if another extension path serializes raw screenshot pixels.
6. Run OCR again on the redacted image. If protected text remains detectable, block the request.

## 5. What the user sees

The privacy UI must make the product credible, not merely safe internally.

| Chat state | User-visible content |
| --- | --- |
| Inspecting | “Reading this page locally…” |
| Privacy pass | Redaction count/types: e.g. `1 face, 2 IDs, 1 email protected`. |
| Ready to send | The exact redacted screenshot thumbnail and: “Only this protected view will be sent.” |
| Sent | A timestamp and SHA-256 fingerprint of the redacted image bytes sent to the server. |
| Model reply | Plain-language response plus one constrained next-action card. |
| Action | “Confirm and execute”; high-risk operations remain blocked or user-only. |
| Unsafe visual context | Explain why image context was withheld; offer DOM-only help. |

Never render, persist, log, or send the raw screenshot in the side panel. The preview must be the same redacted blob that crosses the network boundary.

## 6. Provider strategy: GPT now, open-weight VLM later

### Decision

Use GPT now if it helps us finish the product. Do not pause the privacy/vision work waiting for an open-weight server model.

However, provider replacement is simple **only if we build the adapter boundary now**. GPT and an open-weight VLM both need to receive the same sanitized request and return the same action schema, but their wire formats and hosting differ.

| Concern | Decision |
| --- | --- |
| Current development provider | OpenAI GPT via a server-side provider adapter. GPT-5 supports image input and structured outputs. |
| SIH judged provider | A cloud-hosted or self-hosted open-weight VLM, initially Qwen2.5-VL 3B/7B behind the same adapter. |
| Browser contract | Provider-independent: safe DOM map, redaction manifest, exact redacted image, task. |
| Server response | Provider-independent: strict `NextActionResponse`, never code/selectors/raw values. |
| Secrets | Server environment only. No model key in extension, browser storage, or Git. |
| Privacy | The chosen provider receives the redacted image, never an original screenshot. |

GPT-5 supports image input and structured outputs through the API, so it is suitable as the current multimodal development provider. See [official OpenAI documentation](https://developers.openai.com/api/docs/models/gpt-5). It is not open-weight, so an open-weight VLM path is the safer SIH-aligned final deployment.

### Required provider interface

```ts
type VisionReasoningRequest = {
  task: string;
  context: SanitizedPageContext;
  redactionManifest: RedactionManifest;
  screenshot?: SafeScreenshot;
};

interface VisionReasoningProvider {
  nextAction(request: VisionReasoningRequest): Promise<NextActionResponse>;
}
```

Implement two adapters:

- `OpenAIProvider`: current development path.
- `OpenWeightVlmProvider`: Qwen2.5-VL-compatible server path for SIH.

Both must return the same strictly validated action schema. No extension code should know which provider was used.

## 7. Step-by-step delivery plan

### Phase 1 — Lock the privacy boundary

- [x] Add `SafeScreenshot`, `RedactionManifest`, and `VisionReasoningRequest` contracts. (PR #12)
- [ ] Move all screenshot creation/redaction into a dedicated local module.
- [ ] Add the one-way egress gate and raw-image canary tests. PR #13 isolates the constructor and rejects non-PNG inputs, but an equivalent raw PNG cannot yet be distinguished at runtime; add a dedicated capture/redaction capability and a request-body canary.
- [x] Add screenshot redaction preview to the existing chat UI. (PR #12: preview and request use the same receipt.)
- [ ] Preserve the existing DOM sanitization and local action policy.

**Done when:** a test proves no original image bytes or known fake PII can reach the request body.

### Phase 2 — Add real local vision

- [x] Bundle ONNX Runtime Web and configure WebGPU/WASM fallback. (PR #15; session creation is WebGPU-first, local WASM fallback, single-threaded.)
- [ ] Integrate YuNet face detection in an offscreen worker.
- [ ] Integrate PP-OCR text detection and recognition in an offscreen worker.
- [ ] Detect PII in OCR text with existing and expanded Indian PII rules.
- [ ] Add MobileViT screen-state classification.
- [ ] Merge DOM, OCR, face, and user-marked boxes into one redaction plan.
- [ ] Add redaction padding and post-redaction re-OCR verification.

**Done when:** a screenshot containing a profile face, Aadhaar-like ID, email, and password is redacted locally without network access.

### Phase 3 — Send the protected image to a VLM

- [x] Change the API to accept sanitized structured context plus optional redacted PNG. (PR #12)
- [x] Use a bounded, typed image payload; reject invalid/tampered receipts. (PR #12; PNG data URL capped at 12 MB.)
- [ ] Add the OpenAI multimodal adapter for current development.
- [ ] Include a server prompt explaining redaction placeholders and blacked-out regions.
- [ ] Return only schema-valid actions using supplied local `targetId`s.
- [ ] Add the open-weight Qwen2.5-VL-compatible adapter.

**Done when:** the chat shows an exact redacted screenshot, GPT returns a safe action based on it, and the extension validates that action locally.

### Phase 4 — Finish the trusted interaction loop

- [ ] Show clear redaction explanations and outgoing-image receipt.
- [ ] Support user-marked visual privacy regions, not only fields.
- [ ] Reinspect before every confirmed action.
- [ ] Keep all sensitive typing local; provider-supplied text is never typed automatically.
- [ ] Maintain block rules for MFA, CAPTCHA, payments, submits, destructive operations, and external navigation.
- [ ] Add Firefox-compatible packaging or document the tested browser boundary if Firefox is not achievable in time.

**Done when:** a user can understand what was protected, what was sent, and why an action was or was not allowed.

### Phase 5 — Build evidence, not claims

- [ ] Create a frozen labelled fixture corpus: DOM PII, screenshot PII, canvas-like text, faces/profile photos, fake Indian IDs, English/Devanagari labels, unknown visual content, and adversarial formatting.
- [ ] Add ground-truth boxes/types and expected policy outcomes.
- [ ] Report precision, recall, false negatives, over-redaction, coverage, and OCR residual leaks per PII class.
- [ ] Measure model download size, load time, inference time, JS heap, CPU/GPU use, and WebGPU/WASM fallback behavior.
- [ ] Measure capture, scan, redact, upload, VLM, and total task p50/p95 latency on named hardware.
- [ ] Add browser E2E tests and a recorded controlled demo.

**Done when:** we can show judges a reproducible report rather than a benchmark target or README claim.

## 8. Benchmark definition

| SIH metric | Our measurement |
| --- | --- |
| Visual context accuracy (25%) | Correct screen-state classification and correct action target on labelled task pages/screenshots. |
| PII precision/recall (20%) | TP/FP/FN per PII type for DOM and screenshot OCR; report macro and per-class precision/recall. |
| Redaction precision (20%) | Mask covers each ground-truth region; retained-sensitive-text rate after re-OCR must be zero on the fixture corpus; report over-redacted area separately. |
| Client resources (20%) | Model bundle bytes, cold/warm load time, peak JS heap, GPU/CPU time, WebGPU vs WASM. |
| End-to-end latency (15%) | p50/p95 for each local stage and full task completion, including the selected server provider. |

There is no published SIH passing threshold. We must not invent one. Our internal privacy gate is stricter: **any confirmed outbound raw-PII leak is a release blocker.**

## 9. Competitive bar

The internal 41-repository comparison informed this plan. The projects to beat are not the largest-looking demos; they are the ones with proof.

| Competitor lesson | What Nudge must do better |
| --- | --- |
| Redaction Gate: one-way pixel gate, residue checks, evaluation harness | Build the same hard egress boundary, then make it more understandable through the exact outgoing image receipt. |
| VLESS: OCR + visual perception + re-OCR guard | Ship real, bundled local OCR and face models, not only architecture claims. |
| PS171: resource and latency discipline | Publish measurements from our actual demo hardware, not targets. |
| PrivacyLens: packaged browser models | Keep model downloads modest, lazy-load models, and make fallback behavior visible. |
| Many competitors: README-first claims, model stubs, mock planners | Do not count a feature as done without bundled assets, a working integration, and a test/benchmark. |

### Our defensible differentiators

1. **Exact-image transparency:** the user sees the same protected image that is sent.
2. **Proof before egress:** one allowed screenshot path, canary tests, and post-redaction OCR verification.
3. **Indian visual PII quality:** Aadhaar, PAN, IFSC, account/card patterns, English and Devanagari labels, and face/profile protection.
4. **Human control:** user-marked visual privacy regions, readable reasons, confirmation, and local safety policy.
5. **Measured evidence:** a reproducible privacy/resource/latency report.

## 10. Decisions we will not compromise

1. Raw screenshots, raw DOM, passwords, cookies, tokens, browser storage, and original PII do not reach the server model.
2. No raw-image fallback exists when local visual inspection fails.
3. The model returns a proposal, never code, selectors, or authority to control the browser.
4. The extension validates every action against the live page and policy.
5. GPT is a replaceable server provider; the privacy boundary and client models do not depend on it.
6. We use pretrained local models; we are not training a foundation model.
7. A demo is not enough: every privacy and performance claim must have a test or measurement.

## 11. Immediate next task

### Delivered checkpoint — 8 September 2026

- Merged [PR #12](https://github.com/heddle-wins/nudge/pull/12): protected screenshot contract, redaction manifest, exact-image UI receipt, server integrity check, and multimodal image request shape.
- Merged [PR #13](https://github.com/heddle-wins/nudge/pull/13): one `createSafeScreenshot()` egress constructor plus a non-PNG rejection canary. It is not yet proof against an arbitrary raw PNG; that remains a Phase 1 task.
- Merged [PR #15](https://github.com/heddle-wins/nudge/pull/15): ONNX Runtime Web 1.20.1 and tested WebGPU-to-WASM local-session fallback. The production build currently packages an approximately 11 MB WASM runtime before model assets, so model choice and lazy loading remain resource gates.
- Merged [PR #18](https://github.com/heddle-wins/nudge/pull/18): a static regression canary confirms the named browser capture flows to the local canvas renderer and is absent from the reasoning-request serializer. It supplements, but does not replace, the remaining capability-based raw-PNG proof.
- Verification for this checkpoint: API tests (8), contracts and extension TypeScript checks, privacy-core tests (9), and extension tests (12) all passed locally.

**Progress:** Phase 1 is materially started (2 of 5 checklist items checked); Phase 2 runtime is started (1 of 7 checked); Phase 3 transport is started (2 of 6 checked). A stronger raw-pixel egress canary, YuNet/PP-OCR integration, and the full Phase 5 measurement corpus remain the highest-priority work.

Continue Phase 1 and Phase 2 together:

1. Define the safe screenshot/redaction contracts and one-way egress gate.
2. Add the offscreen vision worker and wire in YuNet face detection.
3. Add PP-OCR and turn its PII boxes into canvas masks.
4. Render the exact redacted blob in the chat before sending it anywhere.

That is the shortest path from the current secure DOM agent to a credible SIH26171 submission.
