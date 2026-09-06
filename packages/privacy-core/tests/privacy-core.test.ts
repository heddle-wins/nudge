import { describe, expect, it } from "vitest";
import { createSanitizedPageContext, sanitizeText } from "../src/index";

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
});
