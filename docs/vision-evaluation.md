# Local visual-redaction evaluation

This document records controlled, reproducible evidence for Nudge's on-device
vision pipeline. It is not a production accuracy claim.

## What runs locally

- YuNet INT8 ONNX finds face regions.
- PP-OCRv4 detector and recognizer find screenshot text and classify recognized
  strings using the local PII policy.
- Every bounded `<img>`, canvas, iframe, video, embedded/object surface, CSS
  image, or generated-content surface is additionally painted fully opaque as
  `visual_content`. This is deliberately broader than face detection: a profile
  image remains protected if a detector misses its face.
- The browser renders masks into a fresh PNG. Only that PNG can receive an
  outbound receipt.

The hosted reasoning model is not used for detection or redaction.

## Fixture protocol

Run:

```sh
node scripts/run-extension-visual-fixtures.mjs
```

The controlled Chrome run builds the fixture-only extension, runs the local
models against seven fictional fixtures, and writes only mask geometry, counts,
timings, model backend metadata, safe receipt hashes, and machine metadata to
an ignored artifact. It never writes a screenshot, request body, or recognized
OCR text.

For each fixture, two checks are intentionally kept separate:

1. **Detector residue scan** runs the ordinary local vision models on the final
   image. It is a useful runtime gate but is not independent of the detector
   that generated the masks.
2. **Final-pixel proof** checks every labelled fixture pixel in the actual
   rendered PNG against the fixed opaque redaction colour. It uses held-out
   fixture geometry, not a model, and returns only aggregate pixel counts.
3. **Protected-receipt proof** runs when a fixture can create a service-worker
   receipt. It checks that exact already-redacted receipt in extension memory
   after DOM fusion, visual masking, residue scanning, and hashing; only its
   aggregate counts are retained.

The test-only helpers are absent from a production build. Verify that boundary
after a production build:

```sh
pnpm --filter @nudge/extension build
rg 'NUDGE_FIXTURE|__nudgeFixture' apps/extension/dist
```

The final command must produce no matches.

The fixture runner also makes one real service-worker request for the DOM
credential fixture to a local schema-valid test server. In memory, that server
checks that the direct fictional email/password values are absent and that the
receipt hash sent in the request is exactly the hash returned to the side panel.
The generated artifact stores only the result booleans, safe hash, and image
dimensions. This complements final-pixel proof; it is not a general-network or
production-server certification.

## Baseline observed on 2026-09-08

The run at `artifacts/extension-visual-fixtures/2026-09-08T08-13-18.644Z/run.json`
used the bundled local ONNX models. This artifact is local/ignored; regenerate
it rather than treating it as committed evidence.

| Fixture | Final-pixel residual | Interpretation |
| --- | ---: | --- |
| Screenshot Indian identifiers | 0 / 13,862 | All labelled pixels covered by detected visual masks. |
| Canvas-like contact card | 0 / 15,000 | All labelled pixels covered. |
| Synthetic face portrait | 0 / 36,900 | YuNet mask covered the labelled fictional face. |
| DOM credential form | 23,820 / 30,240 | Visual scan found only the email; production DOM fusion separately covers both input rectangles. |
| Profile avatar and debit card | 27,706 / 35,806 | OCR recognized/masked the payment text but did not cover the labelled avatar. |
| Adversarial Devanagari spaced ID | 8,762 / 16,698 | OCR found text regions but did not recognize/mask the identifier. |

The initial run's production protected-viewport capability was eligible only
for the DOM credential fixture and fused the two semantic DOM masks with the
visual mask. A later exact-receipt pixel check reported 276 residual pixels
inside its broad fixture rectangles; the browser capture's vertical coordinate
space does not exactly align with that standalone fixture geometry. Treat the
DOM case as a control-flow/egress check, not a zero-pixel release claim, until
its coordinate fixture is recalibrated.

After adding opaque-surface masking, the controlled follow-up run at
`artifacts/extension-visual-fixtures/2026-09-08T17-10-34.822Z/run.json` showed
the active-DOM synthetic portrait as eligible too: its complete 380×380 image
region appeared in the protected viewport's local redaction plan as
`visual_content`, and the exact protected-receipt proof found **0 / 36,900**
residual labelled face pixels. This is evidence that an inspectable DOM profile
image is masked even when face detection is not the deciding control.
Screenshot-only fixture surfaces that do not correspond to an inspectable
active page remain withheld; that is expected and remains fail-closed.

## Protected-viewport duration

The fixture runner also records `protectedViewportMs`: wall time for the local
capability from the extension call until it returns. For an eligible page that
includes tab capture, DOM-mask fusion, visual scan, canvas rendering, residue
scan, and receipt hashing. It excludes all server/network/model-reasoning time.

The later run at
`artifacts/extension-visual-fixtures/2026-09-08T08-22-47.218Z/run.json`
measured **2,045.94 ms** for the eligible DOM credential fixture on its recorded
development host. The withheld fixtures returned in 3.19–6.47 ms because the
fail-closed policy rejected them before capture. This is a single controlled
development measurement, not a device-performance promise; collect repeated
warm/cold runs on the intended demo hardware before reporting a latency target.

## What this proves—and does not

It proves that, for the zero-residual controlled cases, the final renderer
painted the labelled pixels rather than merely returning zero detections. It
also proves the current gaps above.

It does not establish generalisation to arbitrary websites, resilient OCR for
Indian-language/adversarial text, profile-image coverage, or a task-trained
screen-state classifier. Those remain release blockers. Do not quote detector
residue as a zero-leak guarantee outside this fixture protocol.
