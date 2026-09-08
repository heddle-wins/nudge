import { describe, expect, it } from "vitest";
import { nextActionDraftSchema } from "@nudge/contracts";

const draft = { task: "Find my application status" };

describe("proposal egress draft", () => {
  it("accepts only a task from the UI before the service-worker request is assembled", () => {
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
    expect(nextActionDraftSchema.safeParse({ ...draft, context: { forged: true } }).success).toBe(false);
    expect(nextActionDraftSchema.safeParse({ ...draft, redactionManifest: { forged: true } }).success).toBe(false);
    expect(nextActionDraftSchema.safeParse(draft).success).toBe(true);
  });
});
