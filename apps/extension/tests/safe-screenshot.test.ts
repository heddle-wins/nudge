import { describe, expect, it } from "vitest";
import { safeScreenshotSchema } from "@nudge/contracts";
import { createSafeScreenshot } from "../src/safe-screenshot";

describe("safe screenshot egress gate", () => {
  it("creates a receipt only for a PNG data URL and fingerprints its exact bytes", async () => {
    const screenshot = await createSafeScreenshot("data:image/png;base64,cmVkYWN0ZWQ=", { width: 100.7, height: 50.2 });
    expect(safeScreenshotSchema.parse(screenshot)).toEqual(expect.objectContaining({
      kind: "nudge-redacted-screenshot",
      sha256: "b68919aff001d8366249403a2544fba2d833084f1ad22839b6310aadacb6a138",
      width: 101,
      height: 50
    }));
  });

  it("rejects a raw or non-PNG capture before it can become an outbound artifact", async () => {
    await expect(createSafeScreenshot("data:image/jpeg;base64,cmF3", { width: 1, height: 1 }))
      .rejects.toThrow("only export a locally redacted PNG");
  });
});
