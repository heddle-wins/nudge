import { screenStateValues, type ScreenState } from "@nudge/contracts";

export type ScreenStateSample = { expected: ScreenState; predicted: ScreenState };
export type ClassMetrics = { support: number; predicted: number; truePositive: number; falsePositive: number; falseNegative: number; precision: number; recall: number; f1: number };
export type ScreenStateEvaluation = {
  sampleCount: number;
  correct: number;
  accuracy: number;
  macroF1: number;
  /** A release set must exercise every state; missing labels make macro F1 misleading. */
  missingExpectedStates: ScreenState[];
  confusion: Record<ScreenState, Record<ScreenState, number>>;
  byState: Record<ScreenState, ClassMetrics>;
};

function emptyConfusion(): ScreenStateEvaluation["confusion"] {
  return Object.fromEntries(screenStateValues.map((expected) => [
    expected,
    Object.fromEntries(screenStateValues.map((predicted) => [predicted, 0]))
  ])) as ScreenStateEvaluation["confusion"];
}

/**
 * Scores only externally reviewed, held-out labels. This deliberately has no
 * model dependency: the exact same evaluator can compare browser inference
 * against a reproducible release manifest after the model is trained.
 */
export function evaluateScreenStates(samples: ScreenStateSample[]): ScreenStateEvaluation {
  const confusion = emptyConfusion();
  for (const sample of samples) confusion[sample.expected][sample.predicted] += 1;
  const byState = {} as ScreenStateEvaluation["byState"];
  let correct = 0;
  for (const state of screenStateValues) {
    const truePositive = confusion[state][state];
    const support = screenStateValues.reduce((total, predicted) => total + confusion[state][predicted], 0);
    const predicted = screenStateValues.reduce((total, expected) => total + confusion[expected][state], 0);
    const falsePositive = predicted - truePositive;
    const falseNegative = support - truePositive;
    const precision = predicted ? truePositive / predicted : 0;
    const recall = support ? truePositive / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    byState[state] = { support, predicted, truePositive, falsePositive, falseNegative, precision, recall, f1 };
    correct += truePositive;
  }
  return {
    sampleCount: samples.length,
    correct,
    accuracy: samples.length ? correct / samples.length : 0,
    macroF1: screenStateValues.reduce((total, state) => total + byState[state].f1, 0) / screenStateValues.length,
    missingExpectedStates: screenStateValues.filter((state) => byState[state].support === 0),
    confusion,
    byState
  };
}
