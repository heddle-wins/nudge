import { describe, expect, it } from "vitest";
import { evaluateScreenStates } from "../src/vision/screen-state-evaluation";

describe("screen-state evaluation", () => {
  it("reports a full six-state confusion matrix and macro F1", () => {
    const evaluation = evaluateScreenStates([
      { expected: "ordinary_workflow", predicted: "ordinary_workflow" },
      { expected: "credential_or_auth", predicted: "credential_or_auth" },
      { expected: "payment_or_financial", predicted: "payment_or_financial" },
      { expected: "mfa_or_captcha", predicted: "mfa_or_captcha" },
      { expected: "result_or_confirmation", predicted: "result_or_confirmation" },
      { expected: "unknown", predicted: "ordinary_workflow" }
    ]);
    expect(evaluation).toMatchObject({ sampleCount: 6, correct: 5, accuracy: 5 / 6, missingExpectedStates: [] });
    expect(evaluation.confusion.unknown.ordinary_workflow).toBe(1);
    expect(evaluation.byState.ordinary_workflow).toMatchObject({ support: 1, predicted: 2, truePositive: 1, falsePositive: 1, precision: 0.5, recall: 1 });
    expect(evaluation.byState.unknown).toMatchObject({ support: 1, predicted: 0, truePositive: 0, falseNegative: 1, precision: 0, recall: 0, f1: 0 });
    expect(evaluation.macroF1).toBeCloseTo((2 / 3 + 1 + 1 + 1 + 1 + 0) / 6);
  });

  it("flags incomplete held-out sets instead of silently flattering macro F1", () => {
    const evaluation = evaluateScreenStates([{ expected: "ordinary_workflow", predicted: "ordinary_workflow" }]);
    expect(evaluation.missingExpectedStates).toEqual(["credential_or_auth", "payment_or_financial", "mfa_or_captcha", "result_or_confirmation", "unknown"]);
    expect(evaluation.macroF1).toBeCloseTo(1 / 6);
  });
});
