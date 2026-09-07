import * as ort from "onnxruntime-web";

export type VisionBackend = "webgpu" | "wasm";

type SessionFactory = (
  model: string,
  options: ort.InferenceSession.SessionOptions
) => Promise<ort.InferenceSession>;

/** Keep model execution local, preferring WebGPU but never requiring it. */
export async function createLocalVisionSession(
  model: string,
  options: { supportsWebGpu: boolean; createSession?: SessionFactory } = { supportsWebGpu: false }
): Promise<{ session: ort.InferenceSession; backend: VisionBackend }> {
  // Browser extensions should not fan out inference threads: the service worker
  // shares user resources with the active page and the fallback must be stable.
  ort.env.wasm.numThreads = 1;
  const createSession = options.createSession ?? ort.InferenceSession.create;

  if (options.supportsWebGpu) {
    try {
      return {
        session: await createSession(model, { executionProviders: ["webgpu"] }),
        backend: "webgpu"
      };
    } catch {
      // Some models/operators are not WebGPU-compatible. Fall back locally;
      // never move the image to a server to compensate for that failure.
    }
  }

  return {
    session: await createSession(model, { executionProviders: ["wasm"] }),
    backend: "wasm"
  };
}

export function browserSupportsWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
