import type { SafeScreenshot } from "@nudge/contracts";

/**
 * The single constructor for an image that may cross Nudge's reasoning
 * boundary. Call it only after local redaction has rendered a fresh PNG.
 */
export async function createSafeScreenshot(
  redactedDataUrl: string,
  dimensions: { width: number; height: number }
): Promise<SafeScreenshot> {
  const base64 = redactedDataUrl.split(",", 2)[1];
  if (!redactedDataUrl.startsWith("data:image/png;base64,") || !base64) {
    throw new Error("Nudge can only export a locally redacted PNG.");
  }
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    kind: "nudge-redacted-screenshot",
    mimeType: "image/png",
    dataUrl: redactedDataUrl,
    sha256,
    width: Math.max(1, Math.round(dimensions.width)),
    height: Math.max(1, Math.round(dimensions.height))
  };
}
