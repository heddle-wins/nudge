import type { VisualPrivacyRegion } from "./offscreen-client";

/** A redacted screenshot is exportable only when local vision finds no residue. */
export function assertNoVisualPrivacyResidue(regions: VisualPrivacyRegion[]) {
  if (regions.length === 0) return;
  const kinds = [...new Set(regions.map((region) => region.kind))].join(", ");
  throw new Error(`Nudge blocked this screenshot because local verification still found: ${kinds}.`);
}
