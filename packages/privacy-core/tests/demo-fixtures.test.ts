import { describe, expect, it } from "vitest";
import { canExportRedactedViewport, createOutboundSafeContext, createPrivacyInspection } from "../src/index";

const protectedValues = [
  "demo.citizen@example.in",
  "98765 43210",
  "1234 5678 9012",
  "ABCDE1234F",
  "4111 1111 1111 1111",
  "123456789012",
  "DemoPassword!42",
  "sk-v1-demo.1234567890",
  "Private service note"
];

describe("SIH controlled-demo privacy fixture", () => {
  it("redacts every labelled fake PII value while preserving safe workflow labels", () => {
    const context = createOutboundSafeContext({
      url: "https://demo.sevasetu.gov.in/tracker?application=1234-5678-9012",
      title: "SevaSetu application tracker",
      elements: [
        { id: "el_0001", role: "textbox", name: "Email", value: "demo.citizen@example.in", state: { visible: true, enabled: true } },
        { id: "el_0002", role: "textbox", name: "Mobile", value: "98765 43210", state: { visible: true, enabled: true } },
        { id: "el_0003", role: "textbox", name: "Aadhaar number", value: "1234 5678 9012", state: { visible: true, enabled: true } },
        { id: "el_0004", role: "textbox", name: "PAN", value: "ABCDE1234F", state: { visible: true, enabled: true } },
        { id: "el_0005", role: "textbox", name: "Card number", value: "4111 1111 1111 1111", state: { visible: true, enabled: true } },
        { id: "el_0006", role: "textbox", name: "Account number", value: "123456789012", state: { visible: true, enabled: true } },
        { id: "el_0007", role: "textbox", name: "Password", value: "DemoPassword!42", inputType: "password", state: { visible: true, enabled: true } },
        { id: "el_0008", role: "text", name: "Visible page text", text: "Token sk-v1-demo.1234567890", state: { visible: true, enabled: true } },
        { id: "el_0009", role: "textbox", name: "Local search", value: "Private service note", userMarkedPrivate: true, state: { visible: true, enabled: true } },
        { id: "el_0010", role: "button", name: "View application status", text: "Scholarship application status", state: { visible: true, enabled: true } }
      ]
    });

    const serialized = JSON.stringify(context);
    for (const value of protectedValues) expect(serialized).not.toContain(value);
    expect(serialized).toContain("View application status");
    expect(serialized).toContain("Scholarship application status");
    expect(context.page.redactions.types).toEqual(expect.arrayContaining([
      "email", "phone", "government_id", "payment", "account_number", "password", "token", "user_marked"
    ]));
  });

  it("covers every inspectable fake visual PII region before a preview can leave the browser", () => {
    const inspection = createPrivacyInspection({
      url: "https://demo.sevasetu.gov.in",
      title: "SevaSetu demo",
      elements: [],
      visualScanComplete: true,
      hasUninspectableVisualContent: false,
      visualElements: [
        { id: "visual_1", role: "text", name: "Visible page text", text: "Email demo.citizen@example.in", bounds: { x: 20, y: 20, width: 240, height: 28 }, state: { visible: true, enabled: true } },
        { id: "visual_2", role: "text", name: "Visible page text", text: "Phone 98765 43210", bounds: { x: 20, y: 60, width: 180, height: 28 }, state: { visible: true, enabled: true } },
        { id: "visual_3", role: "text", name: "Visible page text", text: "ID 1234 5678 9012", bounds: { x: 20, y: 100, width: 180, height: 28 }, state: { visible: true, enabled: true } },
        { id: "visual_4", role: "text", name: "Visible page text", text: "PAN ABCDE1234F", bounds: { x: 20, y: 140, width: 180, height: 28 }, state: { visible: true, enabled: true } }
      ]
    });

    expect(inspection.visualRedactions).toHaveLength(4);
    expect(inspection.visualRedactions.map((region) => region.kind)).toEqual(expect.arrayContaining(["email", "phone", "government_id"]));
    expect(canExportRedactedViewport({ url: "https://demo.sevasetu.gov.in", title: "SevaSetu demo", elements: [], visualScanComplete: true, hasUninspectableVisualContent: false })).toBe(true);
  });
});
