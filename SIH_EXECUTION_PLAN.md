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
| Measured SIH evaluation | In progress | Frozen synthetic fixtures now rasterize reproducibly in local Chrome and have deterministic redaction metrics; extension-context inference, accuracy reporting, resource benchmarks, and p50/p95 remain. |
| Firefox build and test | Documented boundary | Nudge is Chrome/Chromium-only today; no Firefox compatibility is claimed. See [`docs/browser-support.md`](./docs/browser-support.md). |

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
- [x] Integrate YuNet face detection in an offscreen worker. (PR #28 uses Chrome's MV3 offscreen-document host: it owns the local YuNet session and returns face boxes to the protected screenshot renderer.)
- [x] Integrate PP-OCR text detection and recognition in an offscreen worker. (PRs #30–#32 bundle detector/recognizer/vocabulary, run both in the offscreen host, and turn locally classified OCR PII into captured-image masks.)
- [x] Detect PII in OCR text with existing and expanded Indian PII rules. (PR #34 adds IFSC, voter ID, and passport patterns alongside existing email, phone, Aadhaar, PAN, payment, account, and token rules.)
- [ ] Add MobileViT screen-state classification.
- [x] Merge DOM, OCR, face, and user-marked boxes into one redaction plan. (PR #32 combines DOM-derived—including user-marked—regions with locally classified OCR and YuNet face regions before rendering.)
- [x] Add redaction padding and post-redaction re-OCR verification. (PR #36 re-scans the exact rendered redacted screenshot locally; any remaining face or OCR-classified PII blocks export.)

**Done when:** a screenshot containing a profile face, Aadhaar-like ID, email, and password is redacted locally without network access.

**Current limitation:** the conservative `canExportRedactedViewport()` policy still withholds any page containing an image, canvas, or iframe *before* visual scanning. This means the new local models do not yet permit export of a page with a profile photo or canvas/PDF text. Do not relax that fail-closed rule until controlled browser fixtures prove the visual scan and residue gate cover those surfaces.

### Phase 3 — Send the protected image to a VLM

- [x] Change the API to accept sanitized structured context plus optional redacted PNG. (PR #12)
- [x] Use a bounded, typed image payload; reject invalid/tampered receipts. (PR #12; PNG data URL capped at 12 MB.)
- [x] Add the OpenAI multimodal adapter for current development. (PR #22: direct Responses API, low-detail protected image, strict output, `store: false`.)
- [x] Include a server prompt explaining redaction placeholders and blacked-out regions. (PR #62 instructs both multimodal adapters that protected content is deliberately unavailable and must not be inferred/reconstructed/requested; it must use surviving local targets or request user input.)
- [x] Return only schema-valid actions using supplied local `targetId`s. (PR #64 verifies the server rejects unknown, hidden/disabled, and role-incompatible provider targets before the extension's independent local validation.)
- [ ] Add the open-weight Qwen2.5-VL-compatible adapter.

**Done when:** the chat shows an exact redacted screenshot, GPT returns a safe action based on it, and the extension validates that action locally.

### Phase 4 — Finish the trusted interaction loop

- [x] Show clear redaction explanations and outgoing-image receipt. (PR #45 mounts the exact `SafeScreenshot` preview in the active privacy panel, with visual-mask summary, local scan metadata, and the same image's shortened SHA-256 receipt.)
- [x] Support user-marked visual privacy regions, not only fields. (PR #51 adds a local drag-to-mark picker for the current page. Bounded viewport rectangles become `user_marked` masks; PR #52 keeps them exclusively in the visual-manifest path to avoid duplicate counts. Geometry, pixels, and text never leave the browser.)
- [x] Reinspect before every confirmed action. (PR #47 re-collects the local page context at confirmation time, blocks origin/role/name/visibility/enabled-state drift, re-evaluates policy using that fresh context, then keeps the content executor's final live-target resolution.)
- [x] Keep all sensitive typing local; provider-supplied text is never typed automatically. (PR #49 regression-tests the strict proposal contract, server payload shape, and separate local execution message; no provider action can contain a typing value.)
- [x] Maintain block rules for MFA, CAPTCHA, payments, submits, destructive operations, and external navigation. (PR #54 verifies the existing local executor blocks each class, including OTP fields and same-origin new-tab links, rather than relying on confirmation alone.)
- [x] Add Firefox-compatible packaging or document the tested browser boundary if Firefox is not achievable in time. (PR #56 documents the Chrome/Chromium-only target, Chrome 151 local fixture evidence, and the privacy/evaluation parity gates required before any Firefox claim.)

**Done when:** a user can understand what was protected, what was sent, and why an action was or was not allowed.

### Phase 5 — Build evidence, not claims

- [x] Create a frozen labelled fixture corpus: DOM PII, screenshot PII, canvas-like text, faces/profile photos, fake Indian IDs, English/Devanagari labels, unknown visual content, and adversarial formatting. (PR #39 adds versioned, synthetic source assets—never user data—in `apps/extension/fixtures/visual-privacy`.)
- [x] Add ground-truth boxes/types and expected policy outcomes. (PR #39's manifest labels every sensitive region and makes the unknown surface's required outcome `withhold_visual_export`.)
- [ ] Report precision, recall, false negatives, over-redaction, coverage, and OCR residual leaks per PII class. (PR #60 adds the deterministic metric fields—mask-level precision/false positives, strict 99%-coverage recall/false negatives, pixel coverage, and over-redaction. Actual fixture inference results and OCR-residual reporting remain.)
- [ ] Measure model download size, load time, inference time, JS heap, CPU/GPU use, and WebGPU/WASM fallback behavior. (PR #58 completes the reproducible bundle-byte/sha inventory only: 27,669,688-byte extension, 15,694,505-byte local models, and 11,246,032-byte ONNX WASM runtime on the recorded build. Runtime measurements remain.)
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
- Merged [PR #20](https://github.com/heddle-wins/nudge/pull/20): provider-boundary test proves the verified receipt becomes the multimodal image part and is omitted from the textual context JSON.
- Merged [PR #22](https://github.com/heddle-wins/nudge/pull/22): direct OpenAI Responses API adapter, tested separately from the OpenAI-compatible FastRouter path. It has no browser-held key and receives only the verified protected image plus sanitized context.
- Merged [PRs #24–#26](https://github.com/heddle-wins/nudge/pull/26): bundled OpenCV Zoo INT8 YuNet (100 KB, SHA-256 inventoried), decoded all twelve output heads locally, and connected face boxes to the protected screenshot canvas. This is detection/redaction only—never facial recognition.
- Merged [PR #28](https://github.com/heddle-wins/nudge/pull/28): moved YuNet session creation and raw-pixel inference into Chrome's extension-owned offscreen document. The service worker receives only the resulting face boxes.
- Merged [PRs #30–#32](https://github.com/heddle-wins/nudge/pull/32): bundled PP-OCRv4 ONNX detector/recognizer, decoded local text regions and CTC output, and returned only PII-classified mask boxes from the offscreen document. OCR text itself is not sent to the service worker or reasoning server.
- Merged [PR #34](https://github.com/heddle-wins/nudge/pull/34): expanded local visual-PII rules for OCR-readable IFSC, voter ID, and passport values with regression tests.
- Merged [PR #36](https://github.com/heddle-wins/nudge/pull/36): added a final local residue gate over the exact rendered screenshot. It fails closed if face detection or OCR finds remaining protected visual content; raw OCR text stays in the offscreen document.
- Merged [PR #38](https://github.com/heddle-wins/nudge/pull/38): added deterministic rectangle metrics for fixture coverage, residual sensitive pixels, mask area, over-redaction, and per-kind region counts. A region is only protected at 99% pixel coverage.
- Merged [PR #39](https://github.com/heddle-wins/nudge/pull/39): added the frozen, synthetic visual-privacy fixture corpus and manifest: DOM credentials, screenshot-only Indian IDs, canvas-like contact data, profile/avatar plus test payment card, Devanagari/adversarial formatting, and an unknown visual surface that must be withheld.
- Merged [PR #41](https://github.com/heddle-wins/nudge/pull/41): added `npm run fixtures:rasterize`, which renders all six fixture sources through local headless Chrome and records local PNG SHA-256s, dimensions, expected policy, and rasterization timing. Its artifacts are ignored and it makes no inference/accuracy claim.
- Merged [PR #43](https://github.com/heddle-wins/nudge/pull/43): makes the extension-local offscreen scan return aggregate scan duration and the actual WebGPU/WASM backend(s), so the future controlled fixture runner can measure model execution without exposing raw pixels or OCR text.
- Merged [PR #45](https://github.com/heddle-wins/nudge/pull/45): makes the current side-panel privacy summary show the exact redacted screenshot that is eligible for egress, visual masks/types, local scan backend/timings, and an outgoing-image SHA-256 receipt. It never renders raw capture pixels or OCR text.
- Merged [PR #47](https://github.com/heddle-wins/nudge/pull/47): re-inspects local semantics immediately after confirmation. Target or origin drift blocks before policy/execution; both the reinspection and final executor remain entirely local.
- Merged [PR #49](https://github.com/heddle-wins/nudge/pull/49): adds a direct regression canary for the local sensitive-typing boundary. It proves strict provider actions reject text values and the user-entered value stays on the separate local execution message.
- Merged [PR #51](https://github.com/heddle-wins/nudge/pull/51): added the current-page local drag selector for user-marked visual regions, fused into the screenshot renderer as `user_marked` masks. It has an on-page cancellation affordance and a 20-region cap.
- Merged [PR #52](https://github.com/heddle-wins/nudge/pull/52): corrected visual-mark accounting so a drawn mask remains in the visual redaction manifest without double-counting it in DOM-context redactions.
- Merged [PR #54](https://github.com/heddle-wins/nudge/pull/54): completed regression coverage for local action blocks: payment/destructive actions, submit, MFA/CAPTCHA/OTP, external navigation, and same-origin new-tab navigation all pause.
- Merged [PR #56](https://github.com/heddle-wins/nudge/pull/56): declared the Chrome/Chromium support boundary rather than claiming Firefox compatibility; it lists the actual verified evidence and future Firefox porting gates.
- Merged [PR #58](https://github.com/heddle-wins/nudge/pull/58): added `npm run measure:extension-bundle`, which records exact built-extension/model/ONNX-WASM byte totals and SHA-256s in ignored local evidence.
- Merged [PR #60](https://github.com/heddle-wins/nudge/pull/60): extended fixture metrics with mask-level precision, false-positive masks, strict region recall, and false-negative regions while preserving separate pixel coverage/over-redaction measures.
- Merged [PR #62](https://github.com/heddle-wins/nudge/pull/62): made the FastRouter and OpenAI prompts explicitly redaction-aware, with provider-payload regression tests.
- Merged [PR #64](https://github.com/heddle-wins/nudge/pull/64): completed direct API tests for unknown, hidden/disabled, and role-incompatible provider target IDs.
- Verification for this checkpoint: API tests (12), TypeScript checks, privacy-core tests (11), extension tests (35), and the extension production build all passed locally.

**Progress:** Phase 1 is materially started (2 of 5 checklist items checked); Phase 2 has 6 of 7 items complete (local runtime, offscreen YuNet face redaction, offscreen PP-OCR, local OCR PII rules, fusion, and exact-image residue verification). Screen-state classification remains. Phase 3 is nearly complete (5 of 6 checked); only the Qwen2.5-VL-compatible adapter remains. Phase 4 is complete (6 of 6), with a documented Chrome/Chromium-only browser boundary—not Firefox support. Phase 5 has 2 of 6 checklist items complete: fixtures/labels are frozen, byte evidence is reproducible, and metrics can now score precision/recall/false positives/false negatives; extension-context inference, OCR residual, resource, and latency reports still do not exist. Before changing the current image/canvas/iframe block rule, the next priority is an extension-context fixture run that captures the local model masks and timings.

Continue Phase 1 and Phase 2 together:

1. Define the safe screenshot/redaction contracts and one-way egress gate.
2. Add MobileViT screen-state classification, with a measured model-size and fallback budget.
3. Extend the controlled Chrome fixture runner into extension context so it records local YuNet/PP-OCR mask outputs and timings, then calculate the frozen manifest's metrics.
4. Render the exact redacted blob in the chat before sending it anywhere.

That is the shortest path from the current secure DOM agent to a credible SIH26171 submission.
