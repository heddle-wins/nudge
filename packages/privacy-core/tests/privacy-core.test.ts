import { describe, expect, it } from "vitest";
import { canExportRedactedViewport, createOutboundSafeContext, createPrivacyInspection, createSanitizedPageContext, sanitizeText } from "../src/index";

const secrets = {
  email: "pratik@example.com",
  phone: "9876543210",
  aadhaar: "1234 5678 9012",
  password: "do-not-send-this-password"
};

describe("privacy-core", () => {
  it("redacts common PII patterns in visible text", () => {
    const result = sanitizeText(`Contact ${secrets.email} or ${secrets.phone}`);

    expect(result.value).toBe("Contact [EMAIL_REDACTED] or [PHONE_REDACTED]");
    expect(result.redactions).toEqual(["email", "phone"]);
  });

  it("redacts token-like dashboard values, including truncated representations", () => {
    const result = sanitizeText("Active key: sk-v1-a0...609");

    expect(result.value).toBe("Active key: [TOKEN_REDACTED]");
    expect(result.redactions).toEqual(["token"]);
  });

  it("redacts Indian visual identifiers that OCR can read without a field label", () => {
    const result = sanitizeText("IFSC SBIN 0001234 · Voter ABC 1234567 · Passport P1234567");
    expect(result.value).toBe("IFSC [ACCOUNT_REDACTED] · Voter [ID_REDACTED] · Passport [ID_REDACTED]");
    expect(result.redactions).toEqual(["government_id", "account_number"]);
  });

  it("never exports sensitive field values or query-bearing URLs", () => {
    const context = createSanitizedPageContext({
      url: `https://portal.example.gov.in/track?email=${secrets.email}`,
      title: "Application Tracking",
      elements: [
        {
          id: "el_email",
          role: "textbox",
          name: "Email address",
          value: secrets.email,
          state: { enabled: true, visible: true, required: true }
        },
        {
          id: "el_aadhaar",
          role: "textbox",
          name: "Aadhaar number",
          value: secrets.aadhaar,
          state: { enabled: true, visible: true }
        },
        {
          id: "el_password",
          role: "textbox",
          name: "Password",
          value: secrets.password,
          inputType: "password",
          state: { enabled: true, visible: true }
        }
      ]
    });

    const outboundPayload = JSON.stringify(context);

    expect(context.page.urlOrigin).toBe("https://portal.example.gov.in");
    expect(context.page.redactions.types).toEqual(
      expect.arrayContaining(["email", "government_id", "password"])
    );
    for (const secret of Object.values(secrets)) {
      expect(outboundPayload).not.toContain(secret);
    }
  });

  it("enforces the outbound boundary for semantic, pattern, and user-marked values", () => {
    const privateValues = {
      password: "unpatterned-secret-value",
      email: "owner@private.example",
      phone: "9876543210",
      pan: "ABCDE1234F",
      card: "4111 1111 1111 1111",
      account: "123456789012345",
      custom: "my entirely private application note"
    };
    const context = createOutboundSafeContext({
      url: `https://portal.example.gov.in/?owner=${privateValues.email}`,
      title: `Welcome ${privateValues.email}`,
      elements: [
        { id: "password", role: "textbox", name: "Password", value: privateValues.password, inputType: "password", state: { enabled: true, visible: true } },
        { id: "email", role: "textbox", name: "Email", value: privateValues.email, state: { enabled: true, visible: true } },
        { id: "phone", role: "text", name: "Phone", text: privateValues.phone, state: { enabled: true, visible: true } },
        { id: "pan", role: "text", name: "PAN", text: privateValues.pan, state: { enabled: true, visible: true } },
        { id: "card", role: "text", name: "Payment details", text: privateValues.card, state: { enabled: true, visible: true } },
        { id: "account", role: "text", name: "Account number", text: privateValues.account, state: { enabled: true, visible: true } },
        { id: "custom", role: "textbox", name: "Private note", value: privateValues.custom, userMarkedPrivate: true, state: { enabled: true, visible: true } }
      ]
    });
    const payload = JSON.stringify(context);

    for (const value of Object.values(privateValues)) expect(payload).not.toContain(value);
    expect(context.page.redactions.types).toEqual(expect.arrayContaining([
      "password", "email", "phone", "government_id", "payment", "account_number", "user_marked"
    ]));
  });

  it("derives local-only visual masks without adding geometry to the outbound contract", () => {
    const inspection = createPrivacyInspection({
      url: "https://example.gov.in",
      title: "Example",
      elements: [],
      visualElements: [
        {
          id: "visual_email",
          role: "text",
          name: "Visible page text",
          text: "Email owner@private.example",
          bounds: { x: 20, y: 40, width: 260, height: 32 },
          state: { enabled: true, visible: true }
        },
        {
          id: "visual_private",
          role: "text",
          name: "Private note",
          text: "unpatterned secret",
          userMarkedPrivate: true,
          bounds: { x: 20, y: 80, width: 260, height: 32 },
          state: { enabled: true, visible: true }
        }
      ]
    });

    expect(inspection.visualRedactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "email", x: 20, y: 40 }),
      expect.objectContaining({ kind: "user_marked", x: 20, y: 80 })
    ]));
    expect(JSON.stringify(inspection.context)).not.toContain("bounds");
    expect(JSON.stringify(inspection.context)).not.toContain("owner@private.example");
    expect(inspection.redactionDetails).toEqual([]);
  });

  it("adds user-drawn visual regions as local masks while exporting only a safe count and type", () => {
    const inspection = createPrivacyInspection({
      url: "https://example.gov.in",
      title: "Example",
      elements: [],
      userMarkedVisualRegions: [{ x: 25, y: 45, width: 180, height: 75 }]
    });

    expect(inspection.visualRedactions).toContainEqual({ x: 25, y: 45, width: 180, height: 75, kind: "user_marked" });
    expect(inspection.context.page.redactions).toEqual({ count: 1, types: ["user_marked"] });
    expect(inspection.redactionDetails).toContainEqual({ kind: "user_marked", location: "User-marked screen area 1", source: "visible_text" });
    expect(JSON.stringify(inspection.context)).not.toContain('"x"');
  });

  it("explains each outbound-context redaction using only a safe label", () => {
    const inspection = createPrivacyInspection({
      url: "https://example.gov.in",
      title: "Example",
      elements: [{
        id: "email",
        role: "textbox",
        name: "Contact email",
        value: "owner@private.example",
        state: { enabled: true, visible: true }
      }]
    });

    expect(inspection.redactionDetails).toEqual([{
      kind: "email",
      location: "Contact email",
      source: "field_value"
    }]);
    expect(JSON.stringify(inspection.redactionDetails)).not.toContain("owner@private.example");
  });

  it("fails closed for visual exports with uninspectable or truncated content", () => {
    const base = { url: "https://example.gov.in", title: "Example", elements: [] };
    expect(canExportRedactedViewport(base)).toBe(true);
    expect(canExportRedactedViewport({ ...base, visualScanComplete: false })).toBe(false);
    expect(canExportRedactedViewport({ ...base, hasUninspectableVisualContent: true })).toBe(false);
  });
});
