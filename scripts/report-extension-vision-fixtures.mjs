#!/usr/bin/env node
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "apps/extension/fixtures/visual-privacy");
const argument = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const input = resolve(argument("--input") ?? "");
const output = resolve(argument("--out") ?? resolve(dirname(input), "metrics.json"));
if (!input || relative(root, input).startsWith("..") || relative(root, output).startsWith("..")) throw new Error("--input and --out must remain inside this repository.");
await access(input);

const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8"));
const run = JSON.parse(await readFile(input, "utf8"));
const fixtureById = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]));
const area = (box) => Math.max(0, box.width) * Math.max(0, box.height);
const overlap = (left, right) => Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)) * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
function covered(expected, masks) {
  const xs = [...new Set([expected.x, expected.x + expected.width, ...masks.flatMap((mask) => [Math.max(expected.x, mask.x), Math.min(expected.x + expected.width, mask.x + mask.width)])])].filter((value) => value >= expected.x && value <= expected.x + expected.width).sort((a, b) => a - b);
  const ys = [...new Set([expected.y, expected.y + expected.height, ...masks.flatMap((mask) => [Math.max(expected.y, mask.y), Math.min(expected.y + expected.height, mask.y + mask.height)])])].filter((value) => value >= expected.y && value <= expected.y + expected.height).sort((a, b) => a - b);
  let total = 0;
  for (let x = 0; x < xs.length - 1; x += 1) for (let y = 0; y < ys.length - 1; y += 1) {
    if (masks.some((mask) => xs[x] >= mask.x && xs[x] < mask.x + mask.width && ys[y] >= mask.y && ys[y] < mask.y + mask.height)) total += (xs[x + 1] - xs[x]) * (ys[y + 1] - ys[y]);
  }
  return total;
}
function score(fixtureRun, fixture, masks = fixtureRun.scan.regions ?? []) {
  const expected = fixture.expected ?? [];
  let protectedRegions = 0; let protectedPixels = 0; let residualPixels = 0;
  const byKind = {};
  for (const region of expected) {
    const pixels = area(region); const protectedArea = covered(region, masks);
    const protectedRegion = protectedArea / pixels >= 0.99;
    protectedRegions += Number(protectedRegion); protectedPixels += protectedArea; residualPixels += pixels - protectedArea;
    const kind = byKind[region.kind] ?? { expected: 0, protected: 0, missed: 0 };
    kind.expected += 1; kind.protected += Number(protectedRegion); kind.missed += Number(!protectedRegion); byKind[region.kind] = kind;
  }
  const matchedMasks = masks.filter((mask) => expected.some((region) => overlap(mask, region) > 0)).length;
  const predictedPixels = masks.reduce((total, mask) => total + area(mask), 0);
  return { id: fixture.id, expectedRegions: expected.length, protectedRegions, missedRegions: expected.length - protectedRegions, matchedMasks, falsePositiveMasks: masks.length - matchedMasks, precision: masks.length ? matchedMasks / masks.length : expected.length ? 0 : 1, recall: expected.length ? protectedRegions / expected.length : 1, coverage: protectedPixels + residualPixels ? protectedPixels / (protectedPixels + residualPixels) : 1, residualSensitivePixels: residualPixels, byKind };
}
function renderedMasks(fixtureRun) {
  const padding = 4;
  return (fixtureRun.scan.regions ?? []).map((region) => {
    const x = Math.max(0, region.x - padding);
    const y = Math.max(0, region.y - padding);
    const right = Math.min(fixtureRun.dimensions.width, region.x + region.width + padding);
    const bottom = Math.min(fixtureRun.dimensions.height, region.y + region.height + padding);
    return { ...region, x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  });
}
const fixtures = run.fixtures.map((fixtureRun) => {
  const fixture = fixtureById.get(fixtureRun.id);
  if (!fixture) throw new Error(`Run contains unknown fixture: ${fixtureRun.id}`);
  return score(fixtureRun, fixture);
});
const renderedFixtures = run.fixtures.map((fixtureRun) => {
  const fixture = fixtureById.get(fixtureRun.id);
  if (!fixture) throw new Error(`Run contains unknown fixture: ${fixtureRun.id}`);
  return score(fixtureRun, fixture, renderedMasks(fixtureRun));
});
function aggregate(fixturesToAggregate) {
  const total = fixturesToAggregate.reduce((result, fixture) => ({ expectedRegions: result.expectedRegions + fixture.expectedRegions, protectedRegions: result.protectedRegions + fixture.protectedRegions, missedRegions: result.missedRegions + fixture.missedRegions, matchedMasks: result.matchedMasks + fixture.matchedMasks, falsePositiveMasks: result.falsePositiveMasks + fixture.falsePositiveMasks, residualSensitivePixels: result.residualSensitivePixels + fixture.residualSensitivePixels }), { expectedRegions: 0, protectedRegions: 0, missedRegions: 0, matchedMasks: 0, falsePositiveMasks: 0, residualSensitivePixels: 0 });
  return { ...total, precision: total.matchedMasks / Math.max(1, total.matchedMasks + total.falsePositiveMasks), recall: total.protectedRegions / Math.max(1, total.expectedRegions) };
}
const totals = aggregate(fixtures);
const finalRenderer = {
  paddingPixels: 4,
  scope: "Exact image-coordinate expansion used by the production canvas renderer for visual detector masks. It excludes DOM-derived masks and does not prove post-redaction OCR safety.",
  totals: aggregate(renderedFixtures),
  fixtures: renderedFixtures
};
function percentile(values, percentileValue) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}
const timing = {
  fixtureCount: run.fixtures.length,
  scanMs: { p50: percentile(run.fixtures.map((fixture) => fixture.scan.scanMs), 0.5), p95: percentile(run.fixtures.map((fixture) => fixture.scan.scanMs), 0.95) },
  extensionRoundTripMs: { p50: percentile(run.fixtures.map((fixture) => fixture.extensionRoundTripMs), 0.5), p95: percentile(run.fixtures.map((fixture) => fixture.extensionRoundTripMs), 0.95) },
  // The offscreen document repeats its cached initialization duration on every
  // scan. Those values are not independent cold-start samples.
  initialModelReadyMs: run.fixtures[0]?.scan.modelLoadMs ?? null,
  percentileMethod: "nearest-rank; scan samples include the initial cold scan",
  backends: [...new Set(run.fixtures.flatMap((fixture) => fixture.scan.backends ?? []))]
};
const ocr = {
  detectedRegions: run.fixtures.reduce((total, fixture) => total + (Number.isInteger(fixture.scan.ocrDetectedRegionCount) ? fixture.scan.ocrDetectedRegionCount : 0), 0),
  recognizedRegions: run.fixtures.reduce((total, fixture) => total + (Number.isInteger(fixture.scan.ocrRecognizedRegionCount) ? fixture.scan.ocrRecognizedRegionCount : 0), 0),
  scope: "Count-only telemetry from the local offscreen document; it contains no recognized OCR strings."
};
const heapSnapshots = run.fixtures.flatMap((fixture) => [fixture.localResources?.afterScan, fixture.localResources?.afterResidue]);
const resources = {
  maximumObservedJsHeapUsedBytes: Math.max(0, ...heapSnapshots.map((snapshot) => Number.isFinite(snapshot?.jsHeapUsedBytes) ? snapshot.jsHeapUsedBytes : 0)),
  maximumObservedJsHeapTotalBytes: Math.max(0, ...heapSnapshots.map((snapshot) => Number.isFinite(snapshot?.jsHeapTotalBytes) ? snapshot.jsHeapTotalBytes : 0)),
  cpuTime: "unavailable_from_chrome_devtools",
  gpuUtilization: "unavailable_from_chrome_devtools",
  scope: "Heap values are DevTools snapshots taken after local scan and residue scan, not a guaranteed process peak. CPU/GPU utilization is intentionally not inferred from wall-clock latency."
};
const report = { schemaVersion: 1, sourceRun: relative(root, input), environment: run.environment ?? null, measurementScope: "Detector boxes only; excludes DOM fusion and post-redaction OCR. Coverage is labelled rectangle coverage, not proof of leaked text or final screenshot safety.", protectedCoverageThreshold: 0.99, timing, ocr, resources, totals, fixtures, finalRenderer };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Wrote metrics for ${fixtures.length} fixtures to ${output}\n`);
