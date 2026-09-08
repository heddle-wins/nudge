import { describe, expect, it } from "vitest";
import { nextActionDraftSchema } from "@nudge/contracts";

const draft = {
  task: "Find my application status",
  context: {
    schemaVersion: "1.0",
    source: "nudge-extension",
    page: {
      urlOrigin: "https://service.example.gov.in",
      title: "Application tracking",
      elements: [],
      redactions: { count: 0, types: [] }
    }
  },
  redactionManifest: { count: 0, types: [], visualMaskCount: 0, renderer: "local-canvas-dom-v1" }
};

describe("proposal egress draft", () => {
  it("rejects a screenshot supplied by the UI before the service-worker request is assembled", () => {
    const forgedUiScreenshot = {
      kind: "nudge-redacted-screenshot",
      mimeType: "image/png",
      // This marker represents raw sensitive pixels. It must never be accepted
      // from the UI-to-service-worker proposal message.
      dataUrl: "data:image/png;base64,UElJOmpvZGhkZXZAZXhhbXBsZS5jb20=",
      sha256: "0".repeat(64),
      width: 100,
      height: 50
    };
    expect(nextActionDraftSchema.safeParse({ ...draft, screenshot: forgedUiScreenshot }).success).toBe(false);
    expect(nextActionDraftSchema.safeParse(draft).success).toBe(true);
  });
});
