import { describe, expect, it } from "vitest";
import { SCREEN_STATES, validateReviewedRecords } from "../../../scripts/validate-screen-state-training-set.mjs";

const image = { width: 800, height: 450, sha256: "a".repeat(64) };
function record(state: string, split: string, number: number) {
  return {
    reviewStatus: "approved",
    verifiedState: state,
    sourceId: `screen-${number}`,
    hostname: `${number}.example.gov.in`,
    split,
    datasetRevision: "screenparse-v2-local-2026-09-08",
    license: "CC-BY-4.0",
    reviewerId: "reviewer-a",
    reviewedAt: "2026-09-08T12:00:00.000Z",
    image
  };
}

describe("reviewed screen-state training-set gate", () => {
  it("accepts reviewed, provenance-pinned, website-disjoint records that cover every state", () => {
    const records = SCREEN_STATES.map((state, index) => record(state, ["train", "validation", "test"][index % 3]!, index));
    const result = validateReviewedRecords(records);
    expect(result).toMatchObject({ valid: true, errors: [], summary: { recordCount: 6, hostnameCount: 6, reviewerCount: 1 } });
    expect(result.summary.byState.unknown).toEqual({ train: 0, validation: 0, test: 1, total: 1 });
  });

  it("rejects heuristic candidates, split leakage, and incomplete taxonomy coverage", () => {
    const candidate = { ...record("ordinary_workflow", "train", 1), reviewStatus: "needs_human_review", verifiedState: undefined };
    const leaked = record("ordinary_workflow", "validation", 2);
    leaked.hostname = "1.example.gov.in";
    const result = validateReviewedRecords([candidate, leaked]);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain('reviewStatus must be "approved"');
    expect(result.errors.join("\n")).toContain("appears in both train and validation");
    expect(result.errors.join("\n")).toContain("state unknown: needs at least 1 approved");
  });
});
