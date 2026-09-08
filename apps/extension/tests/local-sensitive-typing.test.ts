import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { proposedActionSchema } from "@nudge/contracts";

const sidePanel = readFileSync(resolve(import.meta.dirname, "../src/sidepanel/main.tsx"), "utf8");
const background = readFileSync(resolve(import.meta.dirname, "../src/background/index.ts"), "utf8");

describe("local sensitive typing boundary", () => {
  it("rejects provider-supplied typing values at the action-contract boundary", () => {
    expect(proposedActionSchema.safeParse({ type: "type", targetId: "el_search", localValue: "secret" }).success).toBe(false);
    expect(proposedActionSchema.safeParse({ type: "type", targetId: "el_search", value: "secret" }).success).toBe(false);
  });

  it("keeps user-entered text on the execution message, separate from the server proposal payload", () => {
    const sendTask = sidePanel.slice(sidePanel.indexOf("async function sendTask"), sidePanel.indexOf("async function executeProposal"));
    expect(sendTask).toContain('type: "NUDGE_REQUEST_NEXT_ACTION"');
    expect(sendTask).not.toContain("localValue");
    expect(sidePanel).toMatch(/type: "NUDGE_EXECUTE_ACTION"[\s\S]{0,220}localValue/);
    const requestStart = background.indexOf("async function requestNextAction");
    const requestEnd = background.indexOf('chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {\n  if (message?.type !== "NUDGE_REQUEST_NEXT_ACTION"', requestStart);
    const requestSource = background.slice(requestStart, requestEnd);
    expect(requestSource).toContain("body: JSON.stringify(request)");
    expect(requestSource).not.toContain("localValue");
  });
});
