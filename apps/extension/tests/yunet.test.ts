import { describe, expect, it } from "vitest";
import { decodeYuNet, preprocessYuNet } from "../src/vision/yunet";

function tensor(data: Float32Array) {
  return { data } as never;
}

function outputs() {
  const result: Record<string, ReturnType<typeof tensor>> = {};
  for (const stride of [8, 16, 32]) {
    const count = (640 / stride) ** 2;
    result[`cls_${stride}`] = tensor(new Float32Array(count));
    result[`obj_${stride}`] = tensor(new Float32Array(count));
    result[`bbox_${stride}`] = tensor(new Float32Array(count * 4));
  }
  return result;
}

describe("YuNet local face detection", () => {
  it("converts RGBA screenshot pixels into BGR NCHW model input", () => {
    const image = { data: new Uint8ClampedArray([10, 20, 30, 255]), width: 1, height: 1 } as ImageData;
    const tensor = preprocessYuNet(image);
    expect(tensor.dims).toEqual([1, 3, 640, 640]);
    expect(Array.from(tensor.data.slice(0, 3))).toEqual([30, 30, 30]);
    expect(tensor.data[640 * 640]).toBe(20);
    expect(tensor.data[2 * 640 * 640]).toBe(10);
  });

  it("decodes and clips a confident face, then suppresses its overlap", () => {
    const result = outputs();
    const first = 10 * 80 + 20;
    const overlapping = 10 * 80 + 21;
    for (const index of [first, overlapping]) {
      (result.cls_8.data as Float32Array)[index] = 0.81;
      (result.obj_8.data as Float32Array)[index] = 1;
      (result.bbox_8.data as Float32Array).set([0.5, 0.5, Math.log(4), Math.log(4)], index * 4);
    }
    const faces = decodeYuNet(result as never, { width: 320, height: 160 });
    expect(faces).toHaveLength(1);
    expect(faces[0]?.x).toBeCloseTo(74);
    expect(faces[0]?.y).toBeCloseTo(17);
    expect(faces[0]?.width).toBeCloseTo(16);
    expect(faces[0]?.height).toBeCloseTo(8);
    expect(faces[0]?.score).toBeCloseTo(0.9);
  });
});
