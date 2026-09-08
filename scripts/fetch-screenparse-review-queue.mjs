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

export function parseArgs(args) {
  const find = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const output = find("--output");
  if (!output || args.includes("--help")) throw new Error("Usage: node scripts/fetch-screenparse-review-queue.mjs --output <queue.jsonl> [--offset <0+>] [--length <1-100>]");
  return {
    output,
    offset: positiveInteger(find("--offset") ?? "0", "--offset"),
    length: positiveInteger(find("--length") ?? "100", "--length", { max: 100 }) || (() => { throw new Error("--length must be at least 1."); })()
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const { output, offset, length } = parseArgs(process.argv.slice(2));
    const result = await fetchScreenParseReviewCandidates({ offset, length });
    await writeFile(output, `${result.records.map((record) => JSON.stringify(record)).join("\n")}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`Prepared ${result.records.length} ScreenParse review candidates at offset ${result.offset}; revision ${result.datasetRevision}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not fetch the ScreenParse review queue."}\n`);
    process.exitCode = 1;
  }
}
