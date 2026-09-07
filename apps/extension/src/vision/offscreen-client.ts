import type { PiiKind } from "@nudge/contracts";
import type { VisionBackend } from "./runtime";

export type VisualPrivacyRegion = { x: number; y: number; width: number; height: number; score: number; kind: PiiKind };
export type VisualPrivacyScan = { regions: VisualPrivacyRegion[]; scanMs: number; backends: VisionBackend[] };

const OFFSCREEN_PATH = "src/offscreen/index.html";
let creatingDocument: Promise<void> | undefined;

async function ensureVisionDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await (chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [documentUrl]
  }) as Promise<chrome.runtime.ExtensionContext[]>);
  if (contexts.length > 0) return;
  creatingDocument ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run local screenshot face and text privacy detection without blocking the extension service worker."
  }).finally(() => { creatingDocument = undefined; });
  await creatingDocument;
}

/** Sends raw pixels only to Nudge's own local offscreen document. */
export async function detectVisualPrivacyOffscreen(screenshot: string): Promise<VisualPrivacyScan> {
  await ensureVisionDocument();
  const requestId = crypto.randomUUID();
  const response = await chrome.runtime.sendMessage({ type: "NUDGE_OFFSCREEN_DETECT_VISUAL_PII", requestId, screenshot });
  if (!response?.ok || response.requestId !== requestId || !Array.isArray(response.regions) || !Number.isFinite(response.scanMs) || !Array.isArray(response.backends) || !response.backends.every((backend: unknown) => backend === "webgpu" || backend === "wasm")) {
    throw new Error("Nudge could not complete local visual privacy detection.");
  }
  return { regions: response.regions as VisualPrivacyRegion[], scanMs: response.scanMs, backends: response.backends as VisionBackend[] };
}
