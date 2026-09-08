#!/usr/bin/env node
/**
 * Fetches a bounded ScreenParse metadata page and emits only Nudge's safe
 * review candidates. Source screenshots and OCR/text are never written by this
 * command; text exists in memory only while the curation rules score a row.
 */
import { writeFile } from "node:fs/promises";
import { reviewRecordFromScreenParse } from "./build-screen-state-review-queue.mjs";

const DATASET = "docling-project/screenparse";
const DATASET_API = `https://huggingface.co/api/datasets/${DATASET}`;
const ROWS_API = "https://datasets-server.huggingface.co/rows";
const SCREEN_STATES = ["ordinary_workflow", "credential_or_auth", "payment_or_financial", "mfa_or_captcha", "result_or_confirmation", "unknown"];

function positiveInteger(value, name, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error(`${name} must be an integer from 0 to ${max}.`);
  return number;
}

/** Fetch and transform one bounded metadata page without retaining source text. */
export async function fetchScreenParseReviewCandidates({ offset = 0, length = 100, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer.");
  if (!Number.isInteger(length) || length < 1 || length > 100) throw new Error("length must be an integer from 1 to 100.");
  const [datasetResponse, rowsResponse] = await Promise.all([
    fetchImpl(DATASET_API),
    fetchImpl(`${ROWS_API}?${new URLSearchParams({ dataset: DATASET, config: "default", split: "train", offset: String(offset), length: String(length) })}`)
  ]);
  if (!datasetResponse.ok) throw new Error(`ScreenParse metadata request failed (${datasetResponse.status}).`);
  if (!rowsResponse.ok) throw new Error(`ScreenParse rows request failed (${rowsResponse.status}).`);
  const dataset = await datasetResponse.json();
  const rowsPayload = await rowsResponse.json();
  if (typeof dataset?.sha !== "string" || !dataset.sha) throw new Error("ScreenParse metadata did not include a revision SHA.");
  if (!Array.isArray(rowsPayload?.rows)) throw new Error("ScreenParse rows response was invalid.");
  const license = typeof dataset?.cardData?.license === "string" ? dataset.cardData.license : "unknown";
  const records = rowsPayload.rows.map((item) => reviewRecordFromScreenParse(item?.row)).map((record) => ({
    ...record,
    datasetRevision: dataset.sha,
    license
  }));
  return { datasetRevision: dataset.sha, license, offset, requestedLength: length, records };
}

/**
 * Scans a bounded number of pages in memory and returns only candidates with
 * one suggested state. Suggestions remain unreviewed triage, never labels.
 */
export async function fetchSuggestedScreenParseCandidates({ suggestedState, count = 20, offset = 0, maxPages = 10, fetchImpl = fetch } = {}) {
  if (!SCREEN_STATES.includes(suggestedState)) throw new Error("suggestedState must be one of the six screen states.");
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("count must be an integer from 1 to 100.");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error("maxPages must be an integer from 1 to 100.");
  const records = [];
  let nextOffset = offset;
  let datasetRevision;
  let license;
  let pagesScanned = 0;
  for (; pagesScanned < maxPages && records.length < count; pagesScanned += 1) {
    const page = await fetchScreenParseReviewCandidates({ offset: nextOffset, length: 100, fetchImpl });
    datasetRevision ??= page.datasetRevision;
    license ??= page.license;
    records.push(...page.records.filter((record) => record.suggestedState === suggestedState).slice(0, count - records.length));
    nextOffset += page.records.length;
    if (page.records.length < 100) break;
  }
  return { datasetRevision, license, suggestedState, requestedCount: count, pagesScanned, startOffset: offset, nextOffset, records };
}

export function parseArgs(args) {
  const find = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const output = find("--output");
  if (!output || args.includes("--help")) throw new Error("Usage: node scripts/fetch-screenparse-review-queue.mjs --output <queue.jsonl> [--offset <0+>] [--length <1-100>] [--suggested-state <state> --count <1-100> --max-pages <1-100>]");
  const suggestedState = find("--suggested-state");
  if (suggestedState && !SCREEN_STATES.includes(suggestedState)) throw new Error("--suggested-state must be one of the six screen states.");
  return {
    output,
    offset: positiveInteger(find("--offset") ?? "0", "--offset"),
    length: positiveInteger(find("--length") ?? "100", "--length", { max: 100 }) || (() => { throw new Error("--length must be at least 1."); })(),
    suggestedState,
    count: positiveInteger(find("--count") ?? "20", "--count", { max: 100 }) || (() => { throw new Error("--count must be at least 1."); })(),
    maxPages: positiveInteger(find("--max-pages") ?? "10", "--max-pages", { max: 100 }) || (() => { throw new Error("--max-pages must be at least 1."); })()
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const { output, offset, length, suggestedState, count, maxPages } = parseArgs(process.argv.slice(2));
    const result = suggestedState
      ? await fetchSuggestedScreenParseCandidates({ suggestedState, count, offset, maxPages })
      : await fetchScreenParseReviewCandidates({ offset, length });
    await writeFile(output, `${result.records.map((record) => JSON.stringify(record)).join("\n")}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`Prepared ${result.records.length} ScreenParse review candidates${suggestedState ? ` suggested as ${suggestedState} after ${result.pagesScanned} page(s)` : ` at offset ${result.offset}`}; revision ${result.datasetRevision}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not fetch the ScreenParse review queue."}\n`);
    process.exitCode = 1;
  }
}
