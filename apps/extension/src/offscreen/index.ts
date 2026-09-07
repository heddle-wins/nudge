import { browserSupportsWebGpu, createLocalVisionSession } from "../vision/runtime";
import { detectFaces, YUNET_MODEL_PATH } from "../vision/yunet";

type VisionRequest = { type: "NUDGE_OFFSCREEN_DETECT_FACES"; requestId: string; screenshot: string };

let yuNetSession: ReturnType<typeof createLocalVisionSession> | undefined;

function localYuNetSession() {
  yuNetSession ??= createLocalVisionSession(chrome.runtime.getURL(YUNET_MODEL_PATH), {
    supportsWebGpu: browserSupportsWebGpu()
  });
  return yuNetSession;
}

chrome.runtime.onMessage.addListener((message: VisionRequest, _sender, sendResponse) => {
  if (message?.type !== "NUDGE_OFFSCREEN_DETECT_FACES" || typeof message.requestId !== "string" || typeof message.screenshot !== "string") return;
  localYuNetSession()
    .then(({ session }) => detectFaces(message.screenshot, session))
    .then(
      ({ faces }) => sendResponse({ ok: true, requestId: message.requestId, faces }),
      () => sendResponse({ ok: false, requestId: message.requestId, error: "Nudge could not complete local face detection." })
    );
  return true;
});
