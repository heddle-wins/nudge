import * as ort from "onnxruntime-web";

export const PPOCR_DETECTOR_PATH = "models/ch_PP-OCRv4_det.onnx";
export const PPOCR_RECOGNIZER_PATH = "models/ch_PP-OCRv4_rec.onnx";
export const PPOCR_VOCABULARY_PATH = "models/ch_PP-OCR_keys_v1.txt";

export type TextRegion = { x: number; y: number; width: number; height: number; score: number };
export type RecognizedText = { text: string; confidence: number };

const DETECTOR_MAX_SIDE = 960;
const DETECTOR_STRIDE = 4;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

function clamp(value: number, lower: number, upper: number) {
  return Math.max(lower, Math.min(upper, value));
}

function dimensionForDetector(width: number, height: number) {
  const scale = Math.min(1, DETECTOR_MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(32, Math.ceil(width * scale / 32) * 32),
    height: Math.max(32, Math.ceil(height * scale / 32) * 32)
  };
}

/** PP-OCR DB detector input: normalized RGB pixels in NCHW form. */
export function preprocessPpOcrDetector(image: ImageData): ort.Tensor {
  const dimensions = dimensionForDetector(image.width, image.height);
  const pixels = new Float32Array(3 * dimensions.width * dimensions.height);
  for (let y = 0; y < dimensions.height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / dimensions.height));
    for (let x = 0; x < dimensions.width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / dimensions.width));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = y * dimensions.width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[channel * dimensions.width * dimensions.height + target] = (image.data[source + channel] / 255 - MEAN[channel]) / STD[channel];
      }
    }
  }
  return new ort.Tensor("float32", pixels, [1, 3, dimensions.height, dimensions.width]);
}

/** Turn PP-OCR's DB probability map into conservative text rectangles. */
export function decodePpOcrRegions(
  scoreMap: ort.Tensor,
  screenshot: { width: number; height: number },
  options: { threshold?: number; minCells?: number } = {}
): TextRegion[] {
  const threshold = options.threshold ?? 0.3;
  const minCells = options.minCells ?? 3;
  const [, , rows, columns] = scoreMap.dims;
  if (!rows || !columns || scoreMap.data.length < rows * columns) throw new Error("PP-OCR detector returned an invalid score map.");
  const scores = scoreMap.data as Float32Array;
  const visited = new Uint8Array(rows * columns);
  const regions: TextRegion[] = [];
  for (let start = 0; start < scores.length; start += 1) {
    if (visited[start] || scores[start] < threshold) continue;
    const queue = [start]; visited[start] = 1;
    let cursor = 0; let minX = columns; let maxX = 0; let minY = rows; let maxY = 0; let total = 0; let count = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++]; const y = Math.floor(current / columns); const x = current % columns;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); total += scores[current]; count += 1;
      for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nextX < 0 || nextY < 0 || nextX >= columns || nextY >= rows) continue;
        const next = nextY * columns + nextX;
        if (!visited[next] && scores[next] >= threshold) { visited[next] = 1; queue.push(next); }
      }
    }
    if (count < minCells) continue;
    const padding = 1;
    const x = clamp((minX - padding) * screenshot.width / columns, 0, screenshot.width);
    const y = clamp((minY - padding) * screenshot.height / rows, 0, screenshot.height);
    const right = clamp((maxX + 1 + padding) * screenshot.width / columns, 0, screenshot.width);
    const bottom = clamp((maxY + 1 + padding) * screenshot.height / rows, 0, screenshot.height);
    if (right > x && bottom > y) regions.push({ x, y, width: right - x, height: bottom - y, score: total / count });
  }
  return regions;
}

/** Create the dynamic-width PP-OCR recognition tensor for one detected region. */
export function preprocessPpOcrRecognizer(image: ImageData, region: TextRegion): ort.Tensor {
  const x0 = clamp(Math.floor(region.x), 0, image.width - 1);
  const y0 = clamp(Math.floor(region.y), 0, image.height - 1);
  const x1 = clamp(Math.ceil(region.x + region.width), x0 + 1, image.width);
  const y1 = clamp(Math.ceil(region.y + region.height), y0 + 1, image.height);
  const width = Math.min(320, Math.max(8, Math.ceil(48 * (x1 - x0) / (y1 - y0))));
  const pixels = new Float32Array(3 * 48 * width);
  for (let y = 0; y < 48; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(x1 - 1, x0 + Math.floor(x * (x1 - x0) / width));
    const sourceY = Math.min(y1 - 1, y0 + Math.floor(y * (y1 - y0) / 48));
    const source = (sourceY * image.width + sourceX) * 4;
    const target = y * width + x;
    for (let channel = 0; channel < 3; channel += 1) pixels[channel * 48 * width + target] = (image.data[source + channel] / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor("float32", pixels, [1, 3, 48, width]);
}

/** CTC decode PP-OCR recognition logits; index zero is the blank symbol. */
export function decodePpOcrText(logits: ort.Tensor, vocabulary: string[]): RecognizedText {
  const [, steps, classes] = logits.dims;
  if (!steps || !classes || logits.data.length < steps * classes) throw new Error("PP-OCR recognizer returned invalid logits.");
  const scores = logits.data as Float32Array; let previous = 0; let confidence = 0; let characters = 0; let text = "";
  for (let step = 0; step < steps; step += 1) {
    let best = 0; let value = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < classes; index += 1) if (scores[step * classes + index] > value) { best = index; value = scores[step * classes + index]; }
    if (best !== 0 && best !== previous) { text += vocabulary[best - 1] ?? ""; confidence += value; characters += 1; }
    previous = best;
  }
  return { text, confidence: characters ? confidence / characters : 0 };
}

export async function loadPpOcrVocabulary() {
  const text = await (await fetch(chrome.runtime.getURL(PPOCR_VOCABULARY_PATH))).text();
  return text.split(/\r?\n/).filter(Boolean);
}
