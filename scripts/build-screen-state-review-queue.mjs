#!/usr/bin/env node
/**
 * Produces a *human-review queue* from local ScreenParse-style JSONL extracts.
 *
 * It deliberately does not download screenshots, persist OCR text, or call a
 * model/service. Dataset-provided text is used in-memory only to triage likely
 * examples into Nudge's screen-state taxonomy. A reviewer must replace the
 * suggested state with a verified label before any record can enter training.
 * Keeping all pages from one hostname in one split prevents site-template
 * leakage from inflating validation results.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

export const SCREEN_STATE_LABELS = [
  "ordinary_workflow",
  "credential_or_auth",
  "payment_or_financial",
  "mfa_or_captcha",
  "result_or_confirmation",
  "unknown"
];

const signals = {
  credential_or_auth: /\b(?:sign[ -]?in|log[ -]?in|password|passcode|username|email address|authenticate)\b/i,
  payment_or_financial: /\b(?:payment|pay now|credit card|debit card|card number|cvv|upi|bank account|billing)\b/i,
  mfa_or_captcha: /\b(?:captcha|one[ -]?time (?:passcode|code)|\botp\b|two[ -]?factor|2fa|verification code|security code)\b/i,
  result_or_confirmation: /\b(?:thank you|success(?:ful|fully)?|confirmed|confirmation|application (?:submitted|received)|payment (?:complete|successful))\b/i
};

function normalizedHostname(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "unknown-host"; }
}

function stableBucket(value) {
  return createHash("sha256").update(value).digest()[0];
}

/** A hostname is assigned once, before review, so no website appears in two splits. */
export function splitForHostname(hostname) {
  const bucket = stableBucket(hostname);
  return bucket < 204 ? "train" : bucket < 230 ? "validation" : "test";
}

function candidateStates(text) {
  return Object.entries(signals)
    .filter(([, pattern]) => pattern.test(text))
    .map(([state]) => state);
}

/**
 * Converts a ScreenParse row (or its minimal `id`, `url`, `texts`, width and
 * height projection) into metadata safe to place in a review queue. It never
 * returns source text: it can contain personal data and belongs only in the
 * locally controlled source extract.
 */
export function reviewRecordFromScreenParse(row) {
  if (!row || typeof row !== "object") throw new Error("Each input line must be a JSON object.");
  if (typeof row.id !== "string" || !row.id) throw new Error("Each row needs a non-empty ScreenParse id.");
  if (typeof row.url !== "string" || !row.url) throw new Error(`Row ${row.id} needs a source URL.`);
  const hostname = normalizedHostname(row.url);
  const sourceText = Array.isArray(row.texts) ? row.texts.filter((text) => typeof text === "string").join(" ") : "";
  const candidates = candidateStates(sourceText);
  const suggestedState = candidates.length === 0
    ? "ordinary_workflow"
    : candidates.length === 1
      ? candidates[0]
      : "unknown";
  return {
    schemaVersion: "1.0",
    source: "screenparse",
    sourceId: row.id,
    hostname,
    split: splitForHostname(hostname),
    image: {
      width: Number.isInteger(row.width) && row.width > 0 ? row.width : undefined,
      height: Number.isInteger(row.height) && row.height > 0 ? row.height : undefined
    },
    suggestedState,
    candidateStates: candidates,
    reviewStatus: "needs_human_review",
    // Only the signal names are retained; raw source strings are intentionally omitted.
    evidenceKinds: candidates.map((state) => `screenparse_text:${state}`)
  };
}

export function parseArgs(args) {
  const read = (flag) => {
    const position = args.indexOf(flag);
    return position >= 0 ? args[position + 1] : undefined;
  };
  const input = read("--input");
  const output = read("--output");
  if (!input || !output || args.includes("--help")) {
    throw new Error("Usage: node scripts/build-screen-state-review-queue.mjs --input <screenparse.jsonl> --output <review-queue.jsonl>");
  }
  return { input, output };
}

export async function buildReviewQueue(input, output) {
  const reader = createInterface({ input: createReadStream(input, { encoding: "utf8" }), crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8", flags: "w" });
  let lines = 0;
  let written = 0;
  for await (const line of reader) {
    lines += 1;
    if (!line.trim()) continue;
    const record = reviewRecordFromScreenParse(JSON.parse(line));
    writer.write(`${JSON.stringify(record)}\n`);
    written += 1;
  }
  await new Promise((resolve, reject) => writer.end((error) => error ? reject(error) : resolve()));
  return { lines, written };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const { input, output } = parseArgs(process.argv.slice(2));
    const result = await buildReviewQueue(input, output);
    process.stdout.write(`Prepared ${result.written} review records from ${result.lines} input lines.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not prepare the review queue."}\n`);
    process.exitCode = 1;
  }
}
