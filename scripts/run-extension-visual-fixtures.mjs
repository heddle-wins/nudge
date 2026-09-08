#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, availableParallelism, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = resolve(root, "apps/extension");
const fixtureRoot = resolve(extension, "fixtures/visual-privacy");
const output = resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : resolve(root, "artifacts/extension-visual-fixtures", new Date().toISOString().replaceAll(":", "-")));
if (relative(root, output).startsWith("..")) throw new Error("--out must remain inside this repository.");
try { await access(output); throw new Error(`Refusing to overwrite existing output directory: ${output}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
// The fixture receiver is deliberately excluded from production bundles. Build
// this controlled test variant here so this command cannot accidentally load a
// preceding production `dist` and report an empty message response as evidence.
await new Promise((resolveBuild, rejectBuild) => {
  const build = spawn(resolve(extension, "node_modules/.bin/vite"), ["build", "--mode", "fixture"], { cwd: extension, stdio: "inherit" });
  build.once("error", rejectBuild);
  build.once("close", (code, signal) => code === 0 ? resolveBuild() : rejectBuild(new Error(`Fixture extension build failed (${signal ?? code ?? "unknown"}).`)));
});
await access(resolve(extension, "dist/manifest.json"));
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "manifest.json"), "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.fixtures)) throw new Error("Unsupported visual fixture manifest.");

const sleep = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
async function waitFor(read, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const value = await read(); if (value) return value; } catch (error) { last = error; } await sleep(100); }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}
async function getJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`${url} returned ${response.status}`); return response.json(); }
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", () => rejectOpen(new Error("Could not connect to Chrome DevTools.")), { once: true }); });
  let serial = 0; const pending = new Map();
  socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); const call = pending.get(message.id); if (!call) return; pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); });
  return { send(method, params = {}) { const id = ++serial; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveCall, rejectCall) => pending.set(id, { resolve: resolveCall, reject: rejectCall })); }, close() { socket.close(); } };
}
function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value;
}

// This receives one fixture-only, schema-valid proposal request. The runner
// retains no request body in its artifact: it checks the privacy boundary in
// memory and records only booleans, dimensions, and the safe receipt hash.
const egressRequests = [];
const egressServer = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/next-action") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    try {
      egressRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        schemaVersion: "1.0",
        action: { type: "report_result", message: "Protected fixture request received." },
        rationale: "The controlled fixture verifies the local egress boundary.",
        confidence: 1,
        requiresConfirmation: true
      }));
    } catch {
      response.writeHead(400).end();
    }
  });
});
await new Promise((resolveListen, rejectListen) => {
  egressServer.once("error", rejectListen);
  egressServer.listen(0, "127.0.0.1", resolveListen);
});
const egressAddress = egressServer.address();
if (!egressAddress || typeof egressAddress === "string") throw new Error("Could not allocate the local egress fixture server.");
const egressServerUrl = `http://127.0.0.1:${egressAddress.port}`;

const profile = await mkdtemp(resolve(tmpdir(), "nudge-vision-fixture-chrome-"));
const port = 9229;
const browser = spawn(process.env.CHROME_BIN ?? "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--hide-scrollbars", "--force-device-scale-factor=1", "--run-all-compositor-stages-before-draw", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
try {
  const version = await waitFor(() => getJson(`http://127.0.0.1:${port}/json/version`), "Chrome DevTools");
  const devtools = await connect(version.webSocketDebuggerUrl);
  const system = await devtools.send("SystemInfo.getInfo").catch(() => undefined);
  const environment = {
    browser: version.Browser,
    protocolVersion: version["Protocol-Version"],
    node: process.version,
    host: {
      platform: platform(),
      release: release(),
      arch: arch(),
      logicalCpuCount: availableParallelism(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemoryBytes: totalmem()
    },
    gpu: system?.gpu?.devices?.map((device) => ({ vendorId: device.vendorId, deviceId: device.deviceId, vendorString: device.vendorString, deviceString: device.deviceString })) ?? []
  };
  const { id: extensionId } = await devtools.send("Extensions.loadUnpacked", { path: resolve(extension, "dist") });
  const extensionOrigin = `chrome-extension://${extensionId}`;
  async function sampleOffscreenMetrics() {
    const offscreen = await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/json/list`))
      .find((target) => target.url === `${extensionOrigin}/src/offscreen/index.html`), "Nudge's offscreen vision debugger");
    const offscreenPage = await connect(offscreen.webSocketDebuggerUrl);
    try {
      await offscreenPage.send("Performance.enable");
      const result = await offscreenPage.send("Performance.getMetrics");
      return {
        jsHeapUsedBytes: metricValue(result.metrics, "JSHeapUsedSize") ?? null,
        jsHeapTotalBytes: metricValue(result.metrics, "JSHeapTotalSize") ?? null
      };
    } finally { offscreenPage.close(); }
  }
  const activationTarget = await devtools.send("Target.createTarget", { url: `${extensionOrigin}/src/sidepanel/index.html` });
  const extensionPageInfo = await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/json/list`)).find((target) => target.id === activationTarget.targetId), "Nudge's extension page debugger");
  const extensionPage = await connect(extensionPageInfo.webSocketDebuggerUrl);
  const runs = [];
  let egress = undefined;
  for (const fixture of manifest.fixtures) {
    const asset = resolve(fixtureRoot, fixture.asset);
    if (relative(fixtureRoot, asset).startsWith("..")) throw new Error(`Fixture escapes its root: ${fixture.id}`);
    const target = await devtools.send("Target.createTarget", { url: pathToFileURL(asset).toString(), newWindow: true, width: fixture.dimensions.width, height: fixture.dimensions.height });
    const pageInfo = await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/json/list`)).find((page) => page.id === target.targetId), `fixture page ${fixture.id}`);
    const page = await connect(pageInfo.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { ...fixture.dimensions, deviceScaleFactor: 1, mobile: false });
    await waitFor(async () => {
      const state = await page.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      return state.result.value === "complete";
    }, `fixture load ${fixture.id}`);
    await page.send("Runtime.evaluate", { expression: "document.fonts ? document.fonts.ready : Promise.resolve()", awaitPromise: true });
    const capture = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const png = Buffer.from(capture.data, "base64");
    const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    if (dimensions.width !== fixture.dimensions.width || dimensions.height !== fixture.dimensions.height) throw new Error(`Incorrect capture dimensions for ${fixture.id}: ${JSON.stringify(dimensions)}`);
    const screenshot = `data:image/png;base64,${capture.data}`;
    const started = performance.now();
    const expression = `new Promise((resolve) => chrome.runtime.sendMessage(${JSON.stringify({ type: "NUDGE_FIXTURE_DETECT_VISUAL_PRIVACY", screenshot })}, resolve))`;
    const detection = await extensionPage.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const scan = detection.result.value?.scan;
    if (!scan || !Array.isArray(scan.regions) || !Number.isFinite(scan.scanMs) || !Number.isFinite(scan.modelLoadMs)) throw new Error(`Extension-local detection failed for ${fixture.id}: ${JSON.stringify(detection)}.`);
    const afterScanMetrics = await sampleOffscreenMetrics();
    const extensionRoundTripMs = Math.round((performance.now() - started) * 100) / 100;
    const masks = scan.regions.map((region) => ({ ...region, coordinateSpace: "image" }));
    // Render and re-scan inside the extension page. Redacted pixels never enter
    // the report; this exercises the same renderer used for outgoing images.
    const residueExpression = `(async () => {
      const redacted = await globalThis.__nudgeFixtureRender(${JSON.stringify(screenshot)}, ${JSON.stringify(masks)}, ${JSON.stringify(dimensions)});
      return chrome.runtime.sendMessage({ type: "NUDGE_FIXTURE_DETECT_VISUAL_PRIVACY", screenshot: redacted });
    })()`;
    const residueResult = await extensionPage.send("Runtime.evaluate", { expression: residueExpression, awaitPromise: true, returnByValue: true });
    const residueScan = residueResult.result.value?.scan;
    if (!residueScan || !Array.isArray(residueScan.regions)) throw new Error(`Residue scan failed for ${fixture.id}`);
    // Ground truth comes from the manifest, not a second invocation of the
    // detector. The verifier sees the redacted PNG only in extension memory
    // and returns aggregate counts, never pixels.
    const pixelProofExpression = `(async () => {
      const redacted = await globalThis.__nudgeFixtureRender(${JSON.stringify(screenshot)}, ${JSON.stringify(masks)}, ${JSON.stringify(dimensions)});
      return globalThis.__nudgeFixturePixelProof(redacted, ${JSON.stringify(dimensions)}, ${JSON.stringify(fixture.expected)});
    })()`;
    const pixelProofResult = await extensionPage.send("Runtime.evaluate", { expression: pixelProofExpression, awaitPromise: true, returnByValue: true });
    const pixelProof = pixelProofResult.result.value;
    if (!pixelProof || !Number.isInteger(pixelProof.expectedSensitivePixels) || !Number.isInteger(pixelProof.redactedSensitivePixels) || !Number.isInteger(pixelProof.residualSensitivePixels)) throw new Error(`Final-pixel proof failed for ${fixture.id}`);
    // Exercise the production protected-viewport capability too. The
    // fixture-only message returns geometry/policy only, never either image.
    const fixtureUrl = pathToFileURL(asset).toString();
    const protectedExpression = `(async () => {
      const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(fixtureUrl)} });
      if (!tab?.id) return { ok: false, error: "Fixture tab was not found." };
      return chrome.runtime.sendMessage({ type: "NUDGE_FIXTURE_CREATE_PROTECTED_VIEWPORT", tabId: tab.id });
    })()`;
    const protectedViewportStarted = performance.now();
    const protectedResult = await extensionPage.send("Runtime.evaluate", { expression: protectedExpression, awaitPromise: true, returnByValue: true });
    // This is the user-visible local capability duration: tab capture, DOM
    // fusion, local visual scan, renderer, residue gate, and receipt hashing.
    // It deliberately excludes network/server reasoning time.
    const protectedViewportMs = Math.round((performance.now() - protectedViewportStarted) * 100) / 100;
    const protectedViewport = protectedResult.result.value;
    if (protectedViewport?.ok && !Array.isArray(protectedViewport.redactionPlan)) throw new Error(`Fixture protected viewport returned invalid geometry for ${fixture.id}`);
    if (fixture.id === "dom-credential-form") {
      const requestExpression = `(async () => {
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(fixtureUrl)} });
        if (!tab?.id) return { ok: false, error: "Fixture tab was not found." };
        const response = await chrome.runtime.sendMessage({
          type: "NUDGE_REQUEST_NEXT_ACTION",
          tabId: tab.id,
          serverUrl: ${JSON.stringify(egressServerUrl)},
          payload: { task: "Verify the protected fixture request" }
        });
        return response?.ok ? {
          ok: true,
          receipt: response.protectedContext?.screenshot ? {
            sha256: response.protectedContext.screenshot.sha256,
            width: response.protectedContext.screenshot.width,
            height: response.protectedContext.screenshot.height
          } : undefined
        } : response;
      })()`;
      const requestResult = await extensionPage.send("Runtime.evaluate", { expression: requestExpression, awaitPromise: true, returnByValue: true });
      const workerResult = requestResult.result.value;
      if (!workerResult?.ok || !workerResult.receipt?.sha256) throw new Error(`Protected fixture request failed: ${JSON.stringify(workerResult)}`);
      const received = await waitFor(() => egressRequests[0], "protected fixture request");
      const serialized = JSON.stringify(received);
      // These are deliberately fictional source values in dom-credential-form.html.
      // The test checks direct serialization separately from the pixel proof,
      // which verifies that the rendered receipt actually covers the regions.
      const forbiddenValues = ["demo.person@example.test", "not-a-real-secret"];
      const leakedValue = forbiddenValues.find((value) => serialized.includes(value));
      if (leakedValue) throw new Error(`Raw fixture value reached the reasoning server: ${leakedValue}`);
      if (!received?.screenshot?.dataUrl?.startsWith("data:image/png;base64,") || received.screenshot.sha256 !== workerResult.receipt.sha256) {
        throw new Error("Reasoning request receipt did not match the worker's protected receipt.");
      }
      egress = {
        status: "verified",
        requestCount: egressRequests.length,
        receiptSha256: workerResult.receipt.sha256,
        width: workerResult.receipt.width,
        height: workerResult.receipt.height,
        rawFixtureValuesAbsent: true,
        exactWorkerReceiptMatched: true
      };
    }
    const afterResidueMetrics = await sampleOffscreenMetrics();
    runs.push({ id: fixture.id, surface: fixture.surface, expectedPolicy: fixture.expectedPolicy ?? "redact_then_evaluate", dimensions, extensionRoundTripMs, scan, residueScan, pixelProof, protectedViewportMs, protectedViewport: protectedViewport?.ok ? { status: "ready", redactionPlan: protectedViewport.redactionPlan, visualRegionCount: protectedViewport.visualRegionCount } : { status: "withheld", reason: typeof protectedViewport?.error === "string" ? protectedViewport.error : "Nudge could not create the protected fixture viewport." }, localResources: { afterScan: afterScanMetrics, afterResidue: afterResidueMetrics, cpuTime: "unavailable_from_chrome_devtools", gpuUtilization: "unavailable_from_chrome_devtools" }, residueScope: "Detector re-scan is not independent. pixelProof separately checks final rendered pixels against fixture ground truth; it covers visual detector masks plus renderer padding and excludes DOM fusion." });
    page.close(); await devtools.send("Target.closeTarget", { targetId: target.targetId });
  }
  await mkdir(output, { recursive: true });
  if (egress?.status !== "verified") throw new Error("The controlled worker-to-server egress check did not run.");
  await writeFile(resolve(output, "run.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), environment, note: "Synthetic extension-context inference evidence. Contains detector mask geometry, timing, backend metadata, local test hardware, and safe receipt hashes only; no raw screenshots, request bodies, or recognized OCR strings.", egress, fixtures: runs }, null, 2)}\n`);
  process.stdout.write(`Ran extension-local vision on ${runs.length} fixtures; evidence written to ${output}\n`);
  extensionPage.close(); await devtools.send("Target.closeTarget", { targetId: activationTarget.targetId }); devtools.close();
} finally {
  if (browser.exitCode === null) { const closed = new Promise((resolveClose) => browser.once("close", resolveClose)); browser.kill(); await Promise.race([closed, sleep(5_000)]); }
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch(() => undefined);
  await new Promise((resolveClose) => egressServer.close(resolveClose));
}
