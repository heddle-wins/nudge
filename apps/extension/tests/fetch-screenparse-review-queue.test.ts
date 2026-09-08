import { describe, expect, it } from "vitest";
import { fetchScreenParseReviewCandidates, fetchSuggestedScreenParseCandidates, parseArgs } from "../../../scripts/fetch-screenparse-review-queue.mjs";

function response(body: unknown) { return { ok: true, status: 200, json: async () => body }; }

describe("ScreenParse review-queue intake", () => {
  it("pins provenance and does not retain source OCR text in candidate records", async () => {
    const fetchImpl = async (url: string) => url.startsWith("https://huggingface.co/")
      ? response({ sha: "a".repeat(40), cardData: { license: "cc-by-4.0" } })
      : response({ rows: [{ row: { id: "screen-1", url: "https://login.example.gov.in", width: 1440, height: 900, texts: ["Sign in with password"] } }] });
    const result = await fetchScreenParseReviewCandidates({ offset: 5, length: 1, fetchImpl });
    expect(result).toMatchObject({ datasetRevision: "a".repeat(40), license: "cc-by-4.0", offset: 5, requestedLength: 1 });
    expect(result.records[0]).toMatchObject({ source: "screenparse", sourceId: "screen-1", suggestedState: "credential_or_auth", datasetRevision: "a".repeat(40) });
    expect(JSON.stringify(result.records[0])).not.toContain("Sign in with password");
  });

  it("bounds the public API page and requires a fresh output path", () => {
    expect(parseArgs(["--output", "/safe/queue.jsonl", "--offset", "100", "--length", "100"])).toMatchObject({ offset: 100, length: 100 });
    expect(() => parseArgs(["--output", "/safe/queue.jsonl", "--length", "101"])).toThrow("0 to 100");
    expect(() => parseArgs(["--output", "/safe/queue.jsonl", "--length", "0"])).toThrow("at least 1");
  });

  it("collects a bounded triage sample without writing any source text", async () => {
    const requestedOffsets: string[] = [];
    const rows = Array.from({ length: 100 }, (_, index) => ({ row: { id: `screen-${index}`, url: `https://${index}.example.gov.in`, width: 100, height: 100, texts: index === 99 ? ["Enter OTP verification code"] : ["Browse services"] } }));
    const fetchImpl = async (url: string) => {
      if (url.startsWith("https://huggingface.co/")) return response({ sha: "b".repeat(40), cardData: { license: "cc-by-4.0" } });
      requestedOffsets.push(new URL(url).searchParams.get("offset")!);
      return response({ rows });
    };
    const result = await fetchSuggestedScreenParseCandidates({ suggestedState: "mfa_or_captcha", count: 1, maxPages: 1, fetchImpl });
    expect(result).toMatchObject({ records: [{ suggestedState: "mfa_or_captcha" }], pagesScanned: 1, nextOffset: 100 });
    expect(requestedOffsets).toEqual(["0"]);
    expect(JSON.stringify(result.records[0])).not.toContain("OTP verification code");
  });
});
