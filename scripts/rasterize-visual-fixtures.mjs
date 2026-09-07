#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(repositoryRoot, "apps/extension/fixtures/visual-privacy");
const manifestPath = resolve(fixtureRoot, "manifest.json");
const defaultOutput = resolve(repositoryRoot, "artifacts/visual-fixtures", new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"));

function argument(name) {
  const position = process.argv.indexOf(name);
  return position === -1 ? undefined : process.argv[position + 1];
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function pngDimensions(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature) throw new Error("Chrome did not create a PNG fixture capture.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun(undefined) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}

const chrome = argument("--chrome") ?? process.env.CHROME_BIN ?? "google-chrome";
const output = resolve(argument("--out") ?? defaultOutput);
if (relative(repositoryRoot, output).startsWith("..")) throw new Error("--out must remain inside this repository.");
try { await access(output); throw new Error(`Refusing to overwrite existing output directory: ${output}`); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.fixtures)) throw new Error("Unsupported visual fixture manifest.");
await mkdir(output, { recursive: true });
const profileDirectory = await mkdtemp(resolve(tmpdir(), "nudge-fixture-chrome-"));
const startedAt = new Date().toISOString();
const runs = [];

try {
  for (const fixture of manifest.fixtures) {
    const source = resolve(fixtureRoot, fixture.asset);
    if (relative(fixtureRoot, source).startsWith("..")) throw new Error(`Fixture escapes its root: ${fixture.id}`);
    await stat(source);
    const capture = resolve(output, `${fixture.id}.png`);
    const started = performance.now();
    await run(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      "--run-all-compositor-stages-before-draw", `--user-data-dir=${profileDirectory}`,
      `--window-size=${fixture.dimensions.width},${fixture.dimensions.height}`, `--screenshot=${capture}`,
      pathToFileURL(source).toString()
    ]);
    const bytes = await readFile(capture);
    const dimensions = pngDimensions(bytes);
    if (dimensions.width !== fixture.dimensions.width || dimensions.height !== fixture.dimensions.height) {
      throw new Error(`${fixture.id} rendered at ${dimensions.width}x${dimensions.height}, expected ${fixture.dimensions.width}x${fixture.dimensions.height}`);
    }
    runs.push({
      id: fixture.id,
      asset: fixture.asset,
      surface: fixture.surface,
      expectedPolicy: fixture.expectedPolicy ?? "redact_then_evaluate",
      png: basename(capture),
      pngSha256: sha256(bytes),
      dimensions,
      rasterizeMs: Math.round((performance.now() - started) * 100) / 100
    });
  }
  await writeFile(resolve(output, "run.json"), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: startedAt,
    browser: chrome,
    note: "Rasterization evidence only. This file does not contain detector masks, OCR text, model accuracy, or browser-extension inference timings.",
    fixtures: runs
  }, null, 2)}\n`);
  process.stdout.write(`Rasterized ${runs.length} fixtures to ${output}\n`);
} finally {
  await rm(profileDirectory, { recursive: true, force: true });
}
