#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, availableParallelism, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = resolve(root, "apps/extension");
const fixtureRoot = resolve(extension, "fixtures/visual-privacy");
const output = resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : resolve(root, "artifacts/extension-visual-fixtures", new Date().toISOString().replaceAll(":", "-")));
if (relative(root, output).startsWith("..")) throw new Error("--out must remain inside this repository.");
try { await access(output); throw new Error(`Refusing to overwrite existing output directory: ${output}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
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
  const activationTarget = await devtools.send("Target.createTarget", { url: `${extensionOrigin}/src/sidepanel/index.html` });
  const extensionPageInfo = await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/json/list`)).find((target) => target.id === activationTarget.targetId), "Nudge's extension page debugger");
  const extensionPage = await connect(extensionPageInfo.webSocketDebuggerUrl);
  const runs = [];
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
    runs.push({ id: fixture.id, surface: fixture.surface, expectedPolicy: fixture.expectedPolicy ?? "redact_then_evaluate", dimensions: fixture.dimensions, extensionRoundTripMs: Math.round((performance.now() - started) * 100) / 100, scan });
    page.close(); await devtools.send("Target.closeTarget", { targetId: target.targetId });
  }
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "run.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), environment, note: "Synthetic extension-context inference evidence. Contains detector mask geometry, timing, backend metadata, and local test hardware only; no raw screenshots or recognized OCR strings.", fixtures: runs }, null, 2)}\n`);
  process.stdout.write(`Ran extension-local vision on ${runs.length} fixtures; evidence written to ${output}\n`);
  extensionPage.close(); await devtools.send("Target.closeTarget", { targetId: activationTarget.targetId }); devtools.close();
} finally {
  if (browser.exitCode === null) { const closed = new Promise((resolveClose) => browser.once("close", resolveClose)); browser.kill(); await Promise.race([closed, sleep(5_000)]); }
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch(() => undefined);
}
