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
| [ScreenParser](https://huggingface.co/docling-project/ScreenParser) | Rejected as the extension state model | This is a legitimate Apache-2.0 YOLO11-L detector trained on ScreenParse v2 and detects 55 UI element classes on full web screenshots. Its current `best.pt` checkpoint is 153,259,543 bytes (checked 2026-09-08 at revision `f029e565f1206577402e43206454522075be3f72`), far above Nudge's sub-10 MB release target. It also emits boxes/classes, not the six workflow states, and lacks an approved ONNX/browser benchmark. |
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

`apps/extension/src/vision/screen-state-evaluation.ts` is the shared evaluator
for the future held-out run. It emits a six-by-six confusion matrix plus
per-state precision, recall, F1, accuracy, and macro F1; it also reports any
taxonomy state missing from the held-out set. Do not report a macro-F1 release
result while `missingExpectedStates` is non-empty.

`apps/extension/fixtures/screen-state/` contains one fictional full-screen
acceptance fixture for each state, including `unknown`. These are a regression
suite for a future browser model, not model-training data or a performance
claim.

Until these gates pass, Nudge must describe its current local models accurately:
YuNet provides face redaction and PP-OCR provides text recognition/redaction;
there is **no task-trained screen-state model yet**.

## Curation workflow now in the repository

For a bounded public ScreenParse metadata page, start with:

```bash
npm run screen-state:fetch-review-queue -- \
  --output /safe/local/nudge-screenparse-candidates.jsonl \
  --offset 0 --length 100
```

This command pins the dataset revision/licence and writes review candidates
only. It does not download source screenshots or write source OCR/text; use a
controlled licensed dataset workspace to retrieve an approved candidate image
when a reviewer needs to see it.

For a bounded triage sample of a restrictive state, use for example:

```bash
npm run screen-state:fetch-review-queue -- \
  --output /safe/local/nudge-mfa-candidates.jsonl \
  --suggested-state mfa_or_captcha --count 20 --max-pages 10
```

The state filter reads up to 10 pages of metadata in memory and writes only
matching candidate metadata. It is a reviewer-queue accelerator, never a
source of labels.

`scripts/build-screen-state-review-queue.mjs` turns a locally obtained
ScreenParse JSONL projection into a review queue. It accepts only records with
`id`, `url`, `texts`, `width`, and `height`; it never downloads images, calls a
network service, or writes the source OCR/text into its output. The text rules
are triage only: every output record has `reviewStatus: "needs_human_review"`.
Conflicting signals become `unknown`, not a fabricated label.

```bash
npm run screen-state:review-queue -- \
  --input /safe/local/screenparse-sample.jsonl \
  --output /safe/local/nudge-screen-state-review.jsonl
```

The resulting queue retains a hostname and a deterministic website-disjoint
train/validation/test split. A reviewer must add a verified state label and
reject ambiguous/inapplicable screenshots before any screenshot reaches a
training set. Store reviewed datasets and screenshots outside the repository;
record only their revision, licence, reviewer protocol, and aggregate metrics
in the release evidence.

Before training, validate the reviewed JSONL metadata (not screenshots) with:

```bash
npm run screen-state:validate-review -- \
  --input /safe/local/nudge-screen-state-reviewed.jsonl \
  --min-per-state 100
```

The validator rejects `needs_human_review` candidates, duplicate source
records, hostname split leakage, missing reviewer/date/provenance/image hash,
and absent taxonomy states. Its output contains aggregate counts only. The
numeric minimum is a release decision, not evidence by itself; keep it modest
only for pipeline smoke tests and raise it for the final held-out evaluation.

After inference, append a local `predictedState` to the approved **test**-split
metadata only, then generate the release confusion matrix with:

```bash
npm run screen-state:evaluate-release -- \
  --input /safe/local/nudge-screen-state-held-out-predictions.jsonl
```

This command rejects unreviewed records, non-test records, duplicate source
IDs, invalid states, and held-out sets missing any state. Its JSON output is
aggregate-only: accuracy, macro F1, confusion matrix, and per-state metrics.

Use the [screen-state human review protocol](./screen-state-review-protocol.md)
for the exact label definitions, conflict precedence, privacy boundary, and
two-pass review procedure.
