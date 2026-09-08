#!/usr/bin/env node
/**
 * Validates a local, human-reviewed screen-state manifest before training.
 * It intentionally reads metadata only: screenshots remain in the controlled
 * local dataset and this command emits aggregate counts rather than OCR text.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export const SCREEN_STATES = [
  "ordinary_workflow",
  "credential_or_auth",
  "payment_or_financial",
  "mfa_or_captcha",
  "result_or_confirmation",
  "unknown"
];
const SPLITS = ["train", "validation", "test"];

function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isIsoDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

/**
 * A reviewed record is intentionally stricter than a curation candidate. The
 * review tool must change `reviewStatus` and add the verified state/provenance;
 * suggestions never qualify as labels for a training run.
 */
export function validateReviewedRecords(records, { minPerState = 1 } = {}) {
  if (!Number.isInteger(minPerState) || minPerState < 1) throw new Error("minPerState must be a positive integer.");
  const errors = [];
  const sourceIds = new Set();
  const splitByHostname = new Map();
  const byState = Object.fromEntries(SCREEN_STATES.map((state) => [state, { train: 0, validation: 0, test: 0, total: 0 }]));
  const reviewedBy = new Set();
  for (const [index, record] of records.entries()) {
    const location = `record ${index + 1}`;
    if (!isPlainObject(record)) { errors.push(`${location}: must be an object.`); continue; }
    if (record.reviewStatus !== "approved") errors.push(`${location}: reviewStatus must be \"approved\".`);
    if (!SCREEN_STATES.includes(record.verifiedState)) errors.push(`${location}: verifiedState must be one of the six screen states.`);
    if (!SPLITS.includes(record.split)) errors.push(`${location}: split must be train, validation, or test.`);
    if (typeof record.sourceId !== "string" || !record.sourceId) errors.push(`${location}: sourceId is required.`);
    else if (sourceIds.has(record.sourceId)) errors.push(`${location}: duplicate sourceId ${record.sourceId}.`);
    else sourceIds.add(record.sourceId);
    if (typeof record.hostname !== "string" || !record.hostname) errors.push(`${location}: hostname is required.`);
    else if (SPLITS.includes(record.split)) {
      const existing = splitByHostname.get(record.hostname);
      if (existing && existing !== record.split) errors.push(`${location}: hostname ${record.hostname} appears in both ${existing} and ${record.split}.`);
      else splitByHostname.set(record.hostname, record.split);
    }
    if (typeof record.datasetRevision !== "string" || !record.datasetRevision) errors.push(`${location}: datasetRevision is required.`);
    if (typeof record.license !== "string" || !record.license) errors.push(`${location}: license is required.`);
    if (typeof record.reviewerId !== "string" || !record.reviewerId) errors.push(`${location}: reviewerId is required.`);
    else reviewedBy.add(record.reviewerId);
    if (!isIsoDate(record.reviewedAt)) errors.push(`${location}: reviewedAt must be an ISO date.`);
    const image = record.image;
    if (!isPlainObject(image) || !Number.isInteger(image.width) || image.width <= 0 || !Number.isInteger(image.height) || image.height <= 0 || typeof image.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(image.sha256)) {
      errors.push(`${location}: image requires positive width/height and a SHA-256.`);
    }
    if (SCREEN_STATES.includes(record.verifiedState) && SPLITS.includes(record.split)) {
      byState[record.verifiedState][record.split] += 1;
      byState[record.verifiedState].total += 1;
    }
  }
  for (const state of SCREEN_STATES) {
    if (byState[state].total < minPerState) errors.push(`state ${state}: needs at least ${minPerState} approved record(s), found ${byState[state].total}.`);
  }
  for (const split of SPLITS) {
    if (!records.some((record) => record?.split === split && record?.reviewStatus === "approved")) errors.push(`split ${split}: needs at least one approved record.`);
  }
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      recordCount: records.length,
      hostnameCount: splitByHostname.size,
      reviewerCount: reviewedBy.size,
      minPerState,
      byState
    }
  };
}

export async function readJsonLines(input) {
  const reader = createInterface({ input: createReadStream(input, { encoding: "utf8" }), crlfDelay: Infinity });
  const records = [];
  let line = 0;
  for await (const value of reader) {
    line += 1;
    if (!value.trim()) continue;
    try { records.push(JSON.parse(value)); } catch { throw new Error(`line ${line}: invalid JSON.`); }
  }
  return records;
}

export function parseArgs(args) {
  const find = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const input = find("--input");
  const minText = find("--min-per-state");
  if (!input || args.includes("--help")) throw new Error("Usage: node scripts/validate-screen-state-training-set.mjs --input <reviewed.jsonl> [--min-per-state <positive integer>]");
  const minPerState = minText === undefined ? 1 : Number(minText);
  if (!Number.isInteger(minPerState) || minPerState < 1) throw new Error("--min-per-state must be a positive integer.");
  return { input, minPerState };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const { input, minPerState } = parseArgs(process.argv.slice(2));
    const result = validateReviewedRecords(await readJsonLines(input), { minPerState });
    if (!result.valid) throw new Error(`Training-set validation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not validate the reviewed screen-state set."}\n`);
    process.exitCode = 1;
  }
}
