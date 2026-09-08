import { sanitizeText } from "@nudge/privacy-core";
import type { PiiKind } from "@nudge/contracts";
import { browserSupportsWebGpu, createLocalVisionSession, type VisionBackend } from "../vision/runtime";
import { detectFaces, YUNET_MODEL_PATH } from "../vision/yunet";
import { detectOcrText, loadPpOcrVocabulary, PPOCR_DETECTOR_PATH, PPOCR_RECOGNIZER_PATH } from "../vision/ppocr";

type VisionRequest = { type: "NUDGE_OFFSCREEN_DETECT_VISUAL_PII"; requestId: string; screenshot: string };
type VisualRegion = { x: number; y: number; width: number; height: number; score: number; kind: PiiKind };

type TimedSession = Awaited<ReturnType<typeof createLocalVisionSession>> & { loadMs: number };

let yuNetSession: Promise<TimedSession> | undefined;
let ppOcrSessions: Promise<{ detector: TimedSession["session"]; recognizer: TimedSession["session"]; vocabulary: string[]; backends: VisionBackend[]; loadMs: number }> | undefined;

function localYuNetSession() {
  yuNetSession ??= timedSession(chrome.runtime.getURL(YUNET_MODEL_PATH));
  return yuNetSession;
}

function localPpOcrSessions() {
  const started = performance.now();
  ppOcrSessions ??= Promise.all([
    timedSession(chrome.runtime.getURL(PPOCR_DETECTOR_PATH)),
    timedSession(chrome.runtime.getURL(PPOCR_RECOGNIZER_PATH)),
    loadPpOcrVocabulary()
  ]).then(([detector, recognizer, vocabulary]) => ({
    detector: detector.session,
    recognizer: recognizer.session,
    vocabulary,
    backends: [detector.backend, recognizer.backend],
    loadMs: Math.round((performance.now() - started) * 100) / 100
  }));
  return ppOcrSessions;
}

function timedSession(modelPath: string): Promise<TimedSession> {
  const started = performance.now();
  return createLocalVisionSession(modelPath, { supportsWebGpu: browserSupportsWebGpu() })
    .then((result) => ({ ...result, loadMs: Math.round((performance.now() - started) * 100) / 100 }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "NUDGE_OFFSCREEN_READY") sendResponse({ ready: true });
});

chrome.runtime.onMessage.addListener((message: VisionRequest, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_OFFSCREEN_DETECT_VISUAL_PII" || typeof message.requestId !== "string" || typeof message.screenshot !== "string") return;
  const started = performance.now();
  Promise.all([localYuNetSession(), localPpOcrSessions()])
    .then(async ([yuNet, ocr]) => {
      const [faces, ocrResult] = await Promise.all([
        detectFaces(message.screenshot, yuNet.session),
        detectOcrText(message.screenshot, ocr.detector, ocr.recognizer, ocr.vocabulary)
      ]);
      const regions: VisualRegion[] = [
        ...faces.faces.map((face) => ({ ...face, kind: "face" as const })),
        ...ocrResult.hits.flatMap((hit) => sanitizeText(hit.text).redactions.map((kind) => ({ x: hit.x, y: hit.y, width: hit.width, height: hit.height, score: hit.score, kind })))
      ];
      return {
        regions,
        scanMs: Math.round((performance.now() - started) * 100) / 100,
        // This is the initial model-ready duration for the resident offscreen document.
        // It remains available on warm scans so benchmark records can separate startup
        // cost from the per-scan duration.
        modelLoadMs: Math.max(yuNet.loadMs, ocr.loadMs),
        backends: [...new Set([yuNet.backend, ...ocr.backends])],
        // Counts only: no recognized text leaves the offscreen document.
        ocrDetectedRegionCount: ocrResult.detectedRegionCount,
        ocrRecognizedRegionCount: ocrResult.hits.length
      };
    })
    .then(
      (result) => sendResponse({ ok: true, requestId: message.requestId, ...result }),
      (error) => sendResponse({
        ok: false,
        requestId: message.requestId,
        error: import.meta.env.MODE === "fixture" && error instanceof Error
          ? error.message
          : "Nudge could not complete local visual privacy detection."
      })
    );
  return true;
});
