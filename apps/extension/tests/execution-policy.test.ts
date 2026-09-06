import { describe, expect, it } from "vitest";
import { evaluateExecutionPolicy } from "../src/execution-policy";
import type { ExecutionRequest, SanitizedPageContext } from "@nudge/contracts";

const context: SanitizedPageContext = {
  schemaVersion: "1.0",
  source: "nudge-extension",
  page: {
    urlOrigin: "https://example.gov",
    title: "Application status",
    redactions: { count: 0, types: [] },
    elements: [
      { id: "el_0001", role: "button", name: "Track application", state: { visible: true, enabled: true } },
      { id: "el_0002", role: "button", name: "Delete account", state: { visible: true, enabled: true } },
      { id: "el_0003", role: "textbox", name: "Password", state: { visible: true, enabled: true } }
    ]
  }
};

function request(targetId: string): ExecutionRequest {
  return { action: { type: "click", targetId }, expectedPageOrigin: "https://example.gov", expectedTarget: context.page.elements.find((item) => item.id === targetId) };
}

describe("local execution policy", () => {
  it("permits a confirmed low-risk click", () => {
    expect(evaluateExecutionPolicy(request("el_0001"), context)).toEqual({ allowed: true });
  });

  it("blocks a destructive control even after confirmation", () => {
    expect(evaluateExecutionPolicy(request("el_0002"), context)).toMatchObject({ allowed: false, outcome: "high_impact_action" });
  });

  it("does not execute model-proposed typing into a sensitive field", () => {
    const typing: ExecutionRequest = { action: { type: "type", targetId: "el_0003" }, expectedPageOrigin: "https://example.gov", expectedTarget: context.page.elements[2] };
    expect(evaluateExecutionPolicy(typing, context)).toMatchObject({ allowed: false, outcome: "sensitive_target" });
  });

  it("allows only user-supplied local text in a verified non-sensitive field", () => {
    const safeContext: SanitizedPageContext = {
      ...context,
      page: { ...context.page, elements: [{ id: "el_0004", role: "textbox", name: "Search services", state: { visible: true, enabled: true } }] }
    };
    const typing: ExecutionRequest = {
      action: { type: "type", targetId: "el_0004" },
      expectedPageOrigin: "https://example.gov",
      expectedTarget: safeContext.page.elements[0],
      localValue: "Scholarship"
    };
    expect(evaluateExecutionPolicy(typing, safeContext)).toEqual({ allowed: true });
  });
});
