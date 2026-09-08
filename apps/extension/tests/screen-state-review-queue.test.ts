import { describe, expect, it } from "vitest";
import { SCREEN_STATE_LABELS, reviewRecordFromScreenParse, splitForHostname } from "../../../scripts/build-screen-state-review-queue.mjs";

describe("screen-state review queue", () => {
  it("only produces the approved taxonomy and requires human review", () => {
    const record = reviewRecordFromScreenParse({
      id: "portal-1",
      url: "https://accounts.example.gov.in/login",
      width: 1440,
      height: 900,
      texts: ["Sign in with your username and password"]
    });
    expect(SCREEN_STATE_LABELS).toContain(record.suggestedState);
    expect(record).toMatchObject({
      hostname: "accounts.example.gov.in",
      suggestedState: "credential_or_auth",
      candidateStates: ["credential_or_auth"],
      reviewStatus: "needs_human_review",
      evidenceKinds: ["screenparse_text:credential_or_auth"]
    });
    expect(JSON.stringify(record)).not.toContain("username and password");
  });

  it("flags conflicting cues as unknown instead of inventing a training label", () => {
    const record = reviewRecordFromScreenParse({
      id: "portal-2",
      url: "https://payments.example.gov.in/verify",
      texts: ["Enter OTP to complete payment"]
    });
    expect(record.suggestedState).toBe("unknown");
    expect(record.candidateStates).toEqual(["payment_or_financial", "mfa_or_captcha"]);
  });

  it("assigns a whole hostname deterministically to one split", () => {
    const split = splitForHostname("service.example.gov.in");
    expect(["train", "validation", "test"]).toContain(split);
    expect(splitForHostname("service.example.gov.in")).toBe(split);
    expect(reviewRecordFromScreenParse({ id: "a", url: "https://service.example.gov.in/a", texts: [] }).split).toBe(split);
    expect(reviewRecordFromScreenParse({ id: "b", url: "https://service.example.gov.in/b", texts: [] }).split).toBe(split);
  });
});
