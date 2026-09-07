import type { FaceRegion } from "./yunet";

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
    justification: "Run local screenshot face detection without blocking the extension service worker."
  }).finally(() => { creatingDocument = undefined; });
  await creatingDocument;
}

/** Sends raw pixels only to Nudge's own local offscreen document. */
export async function detectFacesOffscreen(screenshot: string): Promise<FaceRegion[]> {
  await ensureVisionDocument();
  const requestId = crypto.randomUUID();
  const response = await chrome.runtime.sendMessage({ type: "NUDGE_OFFSCREEN_DETECT_FACES", requestId, screenshot });
  if (!response?.ok || response.requestId !== requestId || !Array.isArray(response.faces)) {
    throw new Error("Nudge could not complete local face detection.");
  }
  return response.faces as FaceRegion[];
}
