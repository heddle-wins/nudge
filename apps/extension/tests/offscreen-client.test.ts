import { afterEach, describe, expect, it, vi } from "vitest";
import { detectVisualPrivacyOffscreen } from "../src/vision/offscreen-client";

afterEach(() => vi.unstubAllGlobals());

describe("offscreen vision client", () => {
  it("creates Nudge's own offscreen host and returns only local face boxes", async () => {
    const createDocument = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      requestId: "fixed-request",
      regions: [{ x: 1, y: 2, width: 3, height: 4, score: 0.9, kind: "face" }],
      scanMs: 42.5,
      modelLoadMs: 31.25,
      backends: ["wasm"]
    });
    vi.stubGlobal("crypto", { randomUUID: () => "fixed-request" });
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://nudge/${path}`,
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
        getContexts: vi.fn().mockResolvedValue([]),
        sendMessage
      },
      offscreen: { Reason: { WORKERS: "WORKERS" }, createDocument }
    });

    await expect(detectVisualPrivacyOffscreen("data:image/png;base64,cmF3LWxvY2FsLW9ubHk=")).resolves.toEqual({
      regions: [{ x: 1, y: 2, width: 3, height: 4, score: 0.9, kind: "face" }], scanMs: 42.5, modelLoadMs: 31.25, backends: ["wasm"]
    });
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({
      url: "src/offscreen/index.html", reasons: ["WORKERS"]
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "NUDGE_OFFSCREEN_DETECT_VISUAL_PII" }));
  });

  it("rejects an incomplete telemetry response instead of treating it as a measured scan", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "fixed-request" });
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://nudge/${path}`,
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
        getContexts: vi.fn().mockResolvedValue([{}]),
        sendMessage: vi.fn().mockResolvedValue({ ok: true, requestId: "fixed-request", regions: [], scanMs: 4, backends: ["wasm"] })
      },
      offscreen: { Reason: { WORKERS: "WORKERS" }, createDocument: vi.fn() }
    });

    await expect(detectVisualPrivacyOffscreen("data:image/png;base64,cmF3LWxvY2FsLW9ubHk=")).rejects.toThrow("could not complete local visual privacy detection");
  });
});
