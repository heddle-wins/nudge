import { sanitizeText } from "@nudge/privacy-core";
import type { PiiKind } from "@nudge/contracts";
import { browserSupportsWebGpu, createLocalVisionSession, type VisionBackend } from "../vision/runtime";
import { detectFaces, YUNET_MODEL_PATH } from "../vision/yunet";
import { detectOcrText, loadPpOcrVocabulary, PPOCR_DETECTOR_PATH, PPOCR_RECOGNIZER_PATH } from "../vision/ppocr";

type VisionRequest = { type: "NUDGE_OFFSCREEN_DETECT_VISUAL_PII"; requestId: string; screenshot: string };
type VisualRegion = { x: number; y: number; width: number; height: number; score: number; kind: PiiKind };

let yuNetSession: ReturnType<typeof createLocalVisionSession> | undefined;
let ppOcrSessions: Promise<{ detector: Awaited<ReturnType<typeof createLocalVisionSession>>["session"]; recognizer: Awaited<ReturnType<typeof createLocalVisionSession>>["session"]; vocabulary: string[]; backends: VisionBackend[] }> | undefined;

function localYuNetSession() {
  yuNetSession ??= createLocalVisionSession(chrome.runtime.getURL(YUNET_MODEL_PATH), {
    supportsWebGpu: browserSupportsWebGpu()
  });
  return yuNetSession;
}

function localPpOcrSessions() {
  ppOcrSessions ??= Promise.all([
    createLocalVisionSession(chrome.runtime.getURL(PPOCR_DETECTOR_PATH), { supportsWebGpu: browserSupportsWebGpu() }),
    createLocalVisionSession(chrome.runtime.getURL(PPOCR_RECOGNIZER_PATH), { supportsWebGpu: browserSupportsWebGpu() }),
    loadPpOcrVocabulary()
  ]).then(([detector, recognizer, vocabulary]) => ({ detector: detector.session, recognizer: recognizer.session, vocabulary, backends: [detector.backend, recognizer.backend] }));
  return ppOcrSessions;
}

chrome.runtime.onMessage.addListener((message: VisionRequest, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_OFFSCREEN_DETECT_VISUAL_PII" || typeof message.requestId !== "string" || typeof message.screenshot !== "string") return;
  const started = performance.now();
  Promise.all([localYuNetSession(), localPpOcrSessions()])
    .then(async ([yuNet, ocr]) => {
      const [faces, text] = await Promise.all([
        detectFaces(message.screenshot, yuNet.session),
        detectOcrText(message.screenshot, ocr.detector, ocr.recognizer, ocr.vocabulary)
      ]);
      const regions: VisualRegion[] = [
        ...faces.faces.map((face) => ({ ...face, kind: "face" as const })),
        ...text.flatMap((hit) => sanitizeText(hit.text).redactions.map((kind) => ({ x: hit.x, y: hit.y, width: hit.width, height: hit.height, score: hit.score, kind })))
      ];
      return { regions, scanMs: Math.round((performance.now() - started) * 100) / 100, backends: [...new Set([yuNet.backend, ...ocr.backends])] };
    })
    .then(
      (result) => sendResponse({ ok: true, requestId: message.requestId, ...result }),
      () => sendResponse({ ok: false, requestId: message.requestId, error: "Nudge could not complete local visual privacy detection." })
    );
  return true;
});
