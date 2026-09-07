import { describe, expect, it, vi } from "vitest";
import { createLocalVisionSession } from "../src/vision/runtime";

describe("local vision runtime", () => {
  it("prefers the local WebGPU backend when it can create a session", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "gpu-session" });
    const result = await createLocalVisionSession("model.onnx", { supportsWebGpu: true, createSession });
    expect(result).toEqual({ session: { id: "gpu-session" }, backend: "webgpu" });
    expect(createSession).toHaveBeenCalledWith("model.onnx", { executionProviders: ["webgpu"] });
  });

  it("falls back to local WASM when WebGPU is unavailable or rejects the model", async () => {
    const createSession = vi.fn()
      .mockRejectedValueOnce(new Error("unsupported operator"))
      .mockResolvedValueOnce({ id: "wasm-session" });
    const result = await createLocalVisionSession("model.onnx", { supportsWebGpu: true, createSession });
    expect(result).toEqual({ session: { id: "wasm-session" }, backend: "wasm" });
    expect(createSession.mock.calls.map((call) => call[1])).toEqual([
      { executionProviders: ["webgpu"] },
      { executionProviders: ["wasm"] }
    ]);
  });
});
