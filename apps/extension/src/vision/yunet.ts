import * as ort from "onnxruntime-web";

export type FaceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export const YUNET_MODEL_PATH = "models/face_detection_yunet_2023mar_int8.onnx";
const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32] as const;

type YuNetOutputs = Record<string, ort.Tensor>;

/** Convert RGBA screenshot pixels to the BGR NCHW input expected by YuNet. */
export function preprocessYuNet(image: ImageData): ort.Tensor {
  const pixels = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const scaleX = image.width / INPUT_SIZE;
  const scaleY = image.height / INPUT_SIZE;
  for (let y = 0; y < INPUT_SIZE; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y * scaleY));
    for (let x = 0; x < INPUT_SIZE; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x * scaleX));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = y * INPUT_SIZE + x;
      pixels[target] = image.data[source + 2];
      pixels[INPUT_SIZE * INPUT_SIZE + target] = image.data[source + 1];
      pixels[2 * INPUT_SIZE * INPUT_SIZE + target] = image.data[source];
    }
  }
  return new ort.Tensor("float32", pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

function clamp(value: number, lower: number, upper: number) {
  return Math.max(lower, Math.min(upper, value));
}

function iou(first: FaceRegion, second: FaceRegion) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function nms(candidates: FaceRegion[], threshold: number, limit: number) {
  const kept: FaceRegion[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (kept.length >= limit) break;
    if (kept.every((existing) => iou(existing, candidate) < threshold)) kept.push(candidate);
  }
  return kept;
}

/** Decode OpenCV Zoo YuNet's twelve output heads into screenshot-relative boxes. */
export function decodeYuNet(
  outputs: YuNetOutputs,
  screenshot: { width: number; height: number },
  options: { scoreThreshold?: number; nmsThreshold?: number; maxFaces?: number } = {}
): FaceRegion[] {
  const scoreThreshold = options.scoreThreshold ?? 0.6;
  const nmsThreshold = options.nmsThreshold ?? 0.3;
  const maxFaces = options.maxFaces ?? 100;
  const candidates: FaceRegion[] = [];

  for (const stride of STRIDES) {
    const classification = outputs[`cls_${stride}`]?.data as Float32Array | undefined;
    const objectness = outputs[`obj_${stride}`]?.data as Float32Array | undefined;
    const boxes = outputs[`bbox_${stride}`]?.data as Float32Array | undefined;
    if (!classification || !objectness || !boxes) throw new Error(`YuNet response is missing the stride-${stride} detection heads.`);
    const columns = INPUT_SIZE / stride;
    const count = columns * columns;
    if (classification.length < count || objectness.length < count || boxes.length < count * 4) {
      throw new Error(`YuNet response has an invalid stride-${stride} shape.`);
    }
    for (let index = 0; index < count; index += 1) {
      const score = Math.sqrt(clamp(classification[index], 0, 1) * clamp(objectness[index], 0, 1));
      if (score < scoreThreshold) continue;
      const row = Math.floor(index / columns);
      const column = index % columns;
      const boxOffset = index * 4;
      const centerX = (column + boxes[boxOffset]) * stride;
      const centerY = (row + boxes[boxOffset + 1]) * stride;
      const width = Math.exp(boxes[boxOffset + 2]) * stride;
      const height = Math.exp(boxes[boxOffset + 3]) * stride;
      const x = (centerX - width / 2) * screenshot.width / INPUT_SIZE;
      const y = (centerY - height / 2) * screenshot.height / INPUT_SIZE;
      const scaledWidth = width * screenshot.width / INPUT_SIZE;
      const scaledHeight = height * screenshot.height / INPUT_SIZE;
      const clippedX = clamp(x, 0, screenshot.width);
      const clippedY = clamp(y, 0, screenshot.height);
      const clippedRight = clamp(x + scaledWidth, 0, screenshot.width);
      const clippedBottom = clamp(y + scaledHeight, 0, screenshot.height);
      if (clippedRight > clippedX && clippedBottom > clippedY) {
        candidates.push({ x: clippedX, y: clippedY, width: clippedRight - clippedX, height: clippedBottom - clippedY, score });
      }
    }
  }
  return nms(candidates, nmsThreshold, maxFaces);
}

/** Run the local model on a screenshot data URL. Nothing leaves the browser. */
export async function detectFaces(
  screenshotDataUrl: string,
  session: ort.InferenceSession
): Promise<{ faces: FaceRegion[]; image: { width: number; height: number } }> {
  const response = await fetch(screenshotDataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  const screenshot = { width: bitmap.width, height: bitmap.height };
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Nudge could not create a local face-detection canvas.");
  context.drawImage(bitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  bitmap.close();
  const outputs = await session.run({ input: preprocessYuNet(pixels) });
  return { faces: decodeYuNet(outputs, screenshot), image: screenshot };
}
