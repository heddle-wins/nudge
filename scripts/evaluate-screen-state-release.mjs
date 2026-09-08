#!/usr/bin/env node
/**
 * Scores a reviewed, held-out screen-state inference manifest. It accepts
 * metadata only; source screenshots and OCR are never read or emitted.
 */
import { SCREEN_STATES, readJsonLines } from "./validate-screen-state-training-set.mjs";

function emptyConfusion() {
  return Object.fromEntries(SCREEN_STATES.map((expected) => [
    expected, Object.fromEntries(SCREEN_STATES.map((predicted) => [predicted, 0]))
  ]));
}

export function evaluateHeldOutPredictions(records) {
  const errors = [];
  const sourceIds = new Set();
  const samples = [];
  for (const [index, record] of records.entries()) {
    const location = `record ${index + 1}`;
    if (!record || typeof record !== "object" || Array.isArray(record)) { errors.push(`${location}: must be an object.`); continue; }
    if (record.reviewStatus !== "approved") errors.push(`${location}: must be human-approved.`);
    if (record.split !== "test") errors.push(`${location}: held-out evaluation accepts only split "test".`);
    if (typeof record.sourceId !== "string" || !record.sourceId) errors.push(`${location}: sourceId is required.`);
    else if (sourceIds.has(record.sourceId)) errors.push(`${location}: duplicate sourceId ${record.sourceId}.`);
    else sourceIds.add(record.sourceId);
    if (!SCREEN_STATES.includes(record.verifiedState)) errors.push(`${location}: verifiedState must be one of the six screen states.`);
    if (!SCREEN_STATES.includes(record.predictedState)) errors.push(`${location}: predictedState must be one of the six screen states.`);
    if (SCREEN_STATES.includes(record.verifiedState) && SCREEN_STATES.includes(record.predictedState)) {
      samples.push({ expected: record.verifiedState, predicted: record.predictedState });
    }
  }
  const confusion = emptyConfusion();
  for (const sample of samples) confusion[sample.expected][sample.predicted] += 1;
  const byState = {};
  let correct = 0;
  for (const state of SCREEN_STATES) {
    const truePositive = confusion[state][state];
    const support = SCREEN_STATES.reduce((total, predicted) => total + confusion[state][predicted], 0);
    const predicted = SCREEN_STATES.reduce((total, expected) => total + confusion[expected][state], 0);
    const falsePositive = predicted - truePositive;
    const falseNegative = support - truePositive;
    const precision = predicted ? truePositive / predicted : 0;
    const recall = support ? truePositive / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    byState[state] = { support, predicted, truePositive, falsePositive, falseNegative, precision, recall, f1 };
    correct += truePositive;
  }
  const sampleCount = samples.length;
  const missingExpectedStates = SCREEN_STATES.filter((state) => byState[state].support === 0);
  if (missingExpectedStates.length) errors.push(`held-out evaluation is missing state(s): ${missingExpectedStates.join(", ")}.`);
  return {
    valid: errors.length === 0,
    errors,
    evaluation: {
      sampleCount,
      correct,
      accuracy: sampleCount ? correct / sampleCount : 0,
      macroF1: SCREEN_STATES.reduce((total, state) => total + byState[state].f1, 0) / SCREEN_STATES.length,
      missingExpectedStates,
      confusion,
      byState
    }
  };
}

function parseArgs(args) {
  const find = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const input = find("--input");
  if (!input || args.includes("--help")) throw new Error("Usage: node scripts/evaluate-screen-state-release.mjs --input <held-out-predictions.jsonl>");
  return { input };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const result = evaluateHeldOutPredictions(await readJsonLines(input));
    if (!result.valid) throw new Error(`Screen-state release evaluation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
    process.stdout.write(`${JSON.stringify(result.evaluation, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not evaluate the held-out screen-state release."}\n`);
    process.exitCode = 1;
  }
}
