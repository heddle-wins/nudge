import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "../src/background/index.ts"), "utf8");

describe("confirmed-action reinspection canary", () => {
  it("collects a fresh local context and compares the proposed target before policy/execution", () => {
    expect(source).toMatch(/async function reinspectActionContext[\s\S]*func: collectRawPageContext/);
    expect(source).toMatch(/freshTarget\.role !== proposedTarget\.role \|\| freshTarget\.name !== proposedTarget\.name/);
    expect(source).toMatch(/const reinspection = await reinspectActionContext\(tabId, proposal, context\)/);
    expect(source).toMatch(/evaluateExecutionPolicy\(request, reinspection\.context\)/);
  });
});
