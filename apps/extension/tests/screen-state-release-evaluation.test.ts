import { describe, expect, it } from "vitest";
import { evaluateHeldOutPredictions } from "../../../scripts/evaluate-screen-state-release.mjs";
import { evaluateScreenStates } from "../src/vision/screen-state-evaluation";

const states = ["ordinary_workflow", "credential_or_auth", "payment_or_financial", "mfa_or_captcha", "result_or_confirmation", "unknown"] as const;

describe("screen-state release evaluation gate", () => {
  it("matches the browser evaluator for a complete human-reviewed held-out set", () => {
    const records = states.map((state, index) => ({
      reviewStatus: "approved", split: "test", sourceId: `held-out-${index}`,
      verifiedState: state, predictedState: state === "unknown" ? "ordinary_workflow" : state
    }));
    const result = evaluateHeldOutPredictions(records);
    const browser = evaluateScreenStates(records.map(({ verifiedState, predictedState }) => ({ expected: verifiedState, predicted: predictedState })));
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result.evaluation).toEqual(browser);
  });

  it("rejects non-test, unreviewed, duplicate, and incomplete records", () => {
    const result = evaluateHeldOutPredictions([
      { reviewStatus: "needs_human_review", split: "train", sourceId: "duplicate", verifiedState: "ordinary_workflow", predictedState: "ordinary_workflow" },
      { reviewStatus: "approved", split: "test", sourceId: "duplicate", verifiedState: "ordinary_workflow", predictedState: "ordinary_workflow" }
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("must be human-approved");
    expect(result.errors.join("\n")).toContain('accepts only split "test"');
    expect(result.errors.join("\n")).toContain("duplicate sourceId");
    expect(result.errors.join("\n")).toContain("missing state(s)");
  });
});
