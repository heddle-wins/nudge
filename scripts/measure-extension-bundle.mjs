#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(repositoryRoot, "apps/extension/dist");
const defaultOutput = resolve(repositoryRoot, "artifacts/extension-bundle", new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"));

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function bytesOf(items) { return items.reduce((total, item) => total + item.bytes, 0); }

const output = resolve(argument("--out") ?? defaultOutput);
if (relative(repositoryRoot, output).startsWith("..")) throw new Error("--out must remain inside this repository.");
try { await access(output); throw new Error(`Refusing to overwrite existing output directory: ${output}`); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const inventory = await Promise.all((await files(distRoot)).map(async (path) => {
  const bytes = await readFile(path);
  return { path: relative(distRoot, path), bytes: bytes.length, sha256: sha256(bytes) };
}));
inventory.sort((left, right) => left.path.localeCompare(right.path));
const models = inventory.filter((item) => item.path.startsWith("models/") && item.path !== "models/MODELS.md");
const wasmRuntime = inventory.filter((item) => item.path.endsWith(".wasm"));
const javascript = inventory.filter((item) => item.path.endsWith(".js"));

await mkdir(output, { recursive: true });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "apps/extension/dist",
  note: "Byte inventory only. It does not measure model load/inference time, heap, CPU/GPU, or privacy accuracy.",
  totals: {
    extensionBytes: bytesOf(inventory),
    localModelBytes: bytesOf(models),
    onnxWasmRuntimeBytes: bytesOf(wasmRuntime),
    javascriptBytes: bytesOf(javascript)
  },
  models,
  wasmRuntime,
  files: inventory
};
await writeFile(resolve(output, "bundle-inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Extension: ${report.totals.extensionBytes} bytes; local models: ${report.totals.localModelBytes} bytes; ONNX WASM runtime: ${report.totals.onnxWasmRuntimeBytes} bytes\n`);
