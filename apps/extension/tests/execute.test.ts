// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeApprovedAction } from "../src/content/execute";
import { collectRawPageContext } from "../src/content/collect";
import type { ExecutionRequest } from "@nudge/contracts";
import { createOutboundSafeContext } from "@nudge/privacy-core";

function request(type: "click" | "select" | "type", role: "button" | "link" | "combobox" | "textbox", name: string, extra: Partial<ExecutionRequest["action"]> = {}): ExecutionRequest {
  return {
    action: { type, targetId: "el_0001", ...extra },
    expectedPageOrigin: window.location.origin,
    expectedTarget: { id: "el_0001", role, name, state: { visible: true, enabled: true } }
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 30, width: 120, height: 30, toJSON: () => ({}) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("approved browser executor", () => {
  it("performs a re-resolved low-risk click", () => {
    const button = document.createElement("button");
    button.textContent = "Track application";
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    document.body.append(button);

    expect(executeApprovedAction(request("click", "button", "Track application"))).toMatchObject({ status: "completed", outcome: "action_completed" });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("pauses a stale target instead of clicking a replacement", () => {
    document.body.innerHTML = "<button>Different control</button>";
    expect(executeApprovedAction(request("click", "button", "Track application"))).toMatchObject({ status: "blocked", outcome: "stale_target" });
  });

  it("refuses form submission and external navigation", () => {
    document.body.innerHTML = "<form><button type='submit'>Continue</button></form>";
    expect(executeApprovedAction(request("click", "button", "Continue"))).toMatchObject({ status: "blocked", outcome: "high_impact_action" });
    document.body.innerHTML = "<a href='https://outside.example'>Open service</a>";
    expect(executeApprovedAction(request("click", "link", "Open service"))).toMatchObject({ status: "blocked", outcome: "external_navigation" });
  });

  it("pauses when a CAPTCHA is present", () => {
    document.body.innerHTML = "<p>Complete CAPTCHA verification</p><input name='verification' /><button>Track application</button>";
    expect(executeApprovedAction(request("click", "button", "Track application"))).toMatchObject({ status: "blocked", outcome: "mfa_or_captcha" });
  });

  it("does not treat an unrelated CAPTCHA mention as a verification gate", () => {
    document.body.innerHTML = "<p>Our help centre explains CAPTCHA safety.</p><button>Refresh inbox</button>";
    expect(executeApprovedAction(request("click", "button", "Refresh inbox"))).toMatchObject({ status: "completed", outcome: "action_completed" });
  });

  it("enters only user-provided local text and keeps it out of later outbound context", () => {
    document.body.innerHTML = "<input placeholder='Search a service' />";
    const input = document.querySelector("input")!;
    const typing = { ...request("type", "textbox", "Search a service"), localValue: "Scholarship" };

    expect(executeApprovedAction(typing)).toMatchObject({ status: "completed", outcome: "action_completed" });
    expect(input.value).toBe("Scholarship");
    expect(input.getAttribute("data-nudge-private")).toBe("true");
    expect(JSON.stringify(createOutboundSafeContext(collectRawPageContext()))).not.toContain("Scholarship");
  });
});
