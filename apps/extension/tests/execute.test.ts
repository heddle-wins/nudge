// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeApprovedAction } from "../src/content/execute";
import { collectRawPageContext } from "../src/content/collect";
import type { ExecutionRequest } from "@nudge/contracts";
import { canExportRedactedViewport, createOutboundSafeContext } from "@nudge/privacy-core";

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
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  // jsdom logs a not-implemented warning for pseudo-element styles. Chrome
  // supports them; model the ordinary no-generated-content case here and
  // override it in the generated-content test below.
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => pseudo
    ? ({ ...nativeGetComputedStyle(element), content: "none" } as unknown as CSSStyleDeclaration)
    : nativeGetComputedStyle(element));
});

afterEach(() => vi.restoreAllMocks());

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
    document.body.innerHTML = "<a href='/status' target='_blank'>Open status</a>";
    expect(executeApprovedAction(request("click", "link", "Open status"))).toMatchObject({ status: "blocked", outcome: "external_navigation" });
  });

  it("refuses payment, destructive, and OTP-adjacent actions even after confirmation", () => {
    document.body.innerHTML = "<button>Pay now</button>";
    expect(executeApprovedAction(request("click", "button", "Pay now"))).toMatchObject({ status: "blocked", outcome: "high_impact_action" });
    document.body.innerHTML = "<button>Delete application</button>";
    expect(executeApprovedAction(request("click", "button", "Delete application"))).toMatchObject({ status: "blocked", outcome: "high_impact_action" });
    document.body.innerHTML = "<input autocomplete='one-time-code'><button>Track application</button>";
    expect(executeApprovedAction(request("click", "button", "Track application"))).toMatchObject({ status: "blocked", outcome: "mfa_or_captcha" });
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

  it("locally masks a CSS URL-backed visual surface before screenshot export", () => {
    document.body.innerHTML = "<div style=\"background-image: url('https://example.test/private-card.png')\">Visible card</div>";
    const raw = collectRawPageContext();
    expect(raw.hasUninspectableVisualContent).toBe(false);
    expect(raw.opaqueVisualRegions).toHaveLength(1);
    expect(canExportRedactedViewport(raw)).toBe(true);
  });

  it("does not treat a CSS gradient as an uninspectable image surface", () => {
    document.body.innerHTML = "<div style=\"background-image: linear-gradient(red, blue)\">Visible card</div>";
    expect(collectRawPageContext().hasUninspectableVisualContent).toBe(false);
  });

  it("locally masks visible CSS generated content before screenshot export", () => {
    document.body.innerHTML = "<div>Visible card</div>";
    const ordinaryStyle = window.getComputedStyle(document.body);
    vi.mocked(window.getComputedStyle).mockImplementation((_element, pseudo) => pseudo === "::before"
      ? ({ ...ordinaryStyle, content: '"private generated label"' } as unknown as CSSStyleDeclaration)
      : ordinaryStyle);
    const raw = collectRawPageContext();
    expect(raw.hasUninspectableVisualContent).toBe(false);
    expect(raw.opaqueVisualRegions).toHaveLength(1);
    expect(canExportRedactedViewport(raw)).toBe(true);
  });
});
