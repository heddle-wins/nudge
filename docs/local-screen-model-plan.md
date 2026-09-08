# Local screen-state model selection

Nudge needs a small local classifier to supplement DOM inspection for visual
screen state. It must never grant browser authority: action policy continues to
use the live local DOM and confirmation checks.

## Decision record — 2026-09-08

| Candidate | Decision | Reason |
| --- | --- | --- |
| Generic MobileViT/ImageNet classifier | Rejected | Its labels describe natural-image objects, not browser state. Calling it a screen-state model would be misleading. |
| [GUI Element Classifier](https://huggingface.co/diogoneno/gui-element-classifier) | Rejected as the state model | It is a real Apache-2.0 6 MB ONNX MobileNetV3 classifier, but labels **crops** as 15 desktop UI element types. Its published training distribution is Linux-desktop-heavy; it does not classify a full browser screen into an actionable state. It may later be evaluated as a secondary crop-typing model. |
| [ScreenParse](https://huggingface.co/datasets/docling-project/screenparse) / ScreenVLM | Dataset accepted; released model rejected | The CC-BY-4.0 dataset has dense web-screen annotations, but the released ScreenVLM is 316M parameters and is not extension-sized. |
| [Google Screen Annotation](https://github.com/google-research-datasets/screen_annotation) | Dataset accepted for evaluation/augmentation | CC-BY-4.0 mobile screenshots with verified UI annotations. It complements web-centric ScreenParse but is not a ready browser ONNX state classifier. |

## Required model, not a proxy

The first shippable model must be trained and evaluated against the exact local
decision taxonomy below. A screenshot-level prediction is advisory metadata;
it cannot bypass any existing redaction, target resolution, confirmation, MFA,
payment, or destructive-action policy.

| State | Local treatment |
| --- | --- |
| `ordinary_workflow` | Continue local DOM inspection and permit only existing low-risk, confirmed actions. |
| `credential_or_auth` | Require DOM credential masking; never auto-type or submit. |
| `payment_or_financial` | Block automatic action and require a user-controlled path. |
| `mfa_or_captcha` | Pause locally. |
| `result_or_confirmation` | Allow only local reporting/low-risk navigation after reinspection. |
| `unknown` | No model-derived action; retain current policy and withhold a visual export if complete local redaction cannot be proved. |

## Training and release gate

1. Derive candidate UI crops/layout features from the two accepted datasets;
   create screen-level labels only with a documented human review protocol.
2. Split by website/app before training so screenshots from one product cannot
   occur in both train and test.
3. Train a sub-10 MB INT8 MobileNetV3/XXS-class model and export ONNX with a
   fixed, tested preprocessing contract.
4. Evaluate precision, recall, macro F1, confusion matrix, model bytes, cold
   load, warm inference, and browser WASM/WebGPU behaviour on held-out sites.
5. Add a controlled extension fixture suite for all six states. An `unknown`
   prediction must be tested as a conservative outcome.
6. Pin source revision, licence, SHA-256, labels, preprocessing, and evaluation
   artifact in `apps/extension/public/models/MODELS.md` before bundling.

Until these gates pass, Nudge must describe its current local models accurately:
YuNet provides face redaction and PP-OCR provides text recognition/redaction;
there is **no task-trained screen-state model yet**.
