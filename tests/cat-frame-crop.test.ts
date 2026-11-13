import { describe, expect, test } from "bun:test";
import {
  COLOR_BACKGROUND_THRESHOLD,
  FRAME_MARGIN_RATIO,
  MAX_NORMALIZED_SIDE,
  findSubjectBox,
  planFrameCrop,
  relativeSubjectBox,
  unionSubjectBoxes,
  type RelativeBox,
} from "../src/cat/frame-crop";

function blank(width: number, height: number, color: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return data;
}

function paint(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
  color: [number, number, number, number],
  stride = width * 4,
): void {
  data.set(color, y * stride + x * 4);
}

describe("cat frame crop planning", () => {
  describe("findSubjectBox", () => {
    test("finds artwork on a transparent background", () => {
      const width = 10;
      const height = 10;
      const data = blank(width, height, [0, 0, 0, 0]);
      const red: [number, number, number, number] = [255, 0, 0, 255];
      paint(data, width, 2, 4, red);
      paint(data, width, 3, 4, red);
      paint(data, width, 4, 5, red);

      // Expanded by one pixel on every side.
      expect(findSubjectBox(data, width, height)).toEqual({
        minX: 1,
        minY: 3,
        maxX: 5,
        maxY: 6,
      });
    });

    test("finds artwork on a baked background and ignores near-background noise", () => {
      const width = 10;
      const height = 10;
      const background: [number, number, number, number] = [30, 30, 46, 255];
      const data = blank(width, height, background);
      const subject: [number, number, number, number] = [200, 100, 50, 255];
      paint(data, width, 2, 2, subject);
      paint(data, width, 3, 2, subject);
      paint(data, width, 4, 3, subject);
      // A subtle gradient pixel stays background.
      paint(data, width, 0, 0, [30 + COLOR_BACKGROUND_THRESHOLD, 30, 46, 255]);
      paint(data, width, 9, 9, [31, 31, 47, 255]);

      expect(findSubjectBox(data, width, height)).toEqual({
        minX: 1,
        minY: 1,
        maxX: 5,
        maxY: 4,
      });
    });

    test("returns null for a blank frame", () => {
      const data = blank(8, 8, [30, 30, 46, 255]);
      expect(findSubjectBox(data, 8, 8)).toBeNull();
      expect(findSubjectBox(new Uint8Array(8 * 8 * 4), 8, 8)).toBeNull();
    });

    test("handles padded rows via stride", () => {
      const width = 4;
      const height = 4;
      const stride = width * 4 + 8;
      const data = new Uint8Array(stride * height);
      paint(data, width, 1, 1, [255, 0, 0, 255], stride);
      paint(data, width, 2, 2, [255, 0, 0, 255], stride);

      expect(findSubjectBox(data, width, height, stride)).toEqual({
        minX: 0,
        minY: 0,
        maxX: 3,
        maxY: 3,
      });
    });
  });

  test("converts a pixel box to relative coordinates", () => {
    expect(
      relativeSubjectBox({ minX: 10, minY: 20, maxX: 39, maxY: 59 }, 100, 100),
    ).toEqual({ minX: 0.1, minY: 0.2, maxX: 0.4, maxY: 0.6 });
  });

  test("unions relative boxes across animation frames", () => {
    const boxes: RelativeBox[] = [
      { minX: 0.2, minY: 0.1, maxX: 0.4, maxY: 0.3 },
      { minX: 0.1, minY: 0.2, maxX: 0.5, maxY: 0.6 },
    ];
    expect(unionSubjectBoxes(boxes)).toEqual({
      minX: 0.1,
      minY: 0.1,
      maxX: 0.5,
      maxY: 0.6,
    });
  });

  test("uses the full canvas when there are no boxes", () => {
    expect(unionSubjectBoxes([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  test("plans a square crop with transparent padding", () => {
    const plan = planFrameCrop(
      { minX: 0.2, minY: 0.3, maxX: 0.4, maxY: 0.5 },
      100,
      100,
      { margin: 0.1, maxSide: 384 },
    );

    expect(plan.extract).toEqual({ left: 20, top: 30, width: 20, height: 20 });
    expect(plan.side).toBe(Math.round(20 * (1 + 0.1 * 2)));
    expect(plan.extend).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(plan.resizeSide).toBe(0);
  });

  test("pads a wide crop to a square", () => {
    const plan = planFrameCrop(
      { minX: 0.1, minY: 0.4, maxX: 0.9, maxY: 0.6 },
      100,
      100,
      { margin: 0, maxSide: 384 },
    );

    expect(plan.extract).toEqual({ left: 10, top: 40, width: 80, height: 20 });
    expect(plan.side).toBe(80);
    expect(plan.extend).toEqual({ top: 30, right: 0, bottom: 30, left: 0 });
  });

  test("downscales oversized square crops and clamps invalid boxes", () => {
    const plan = planFrameCrop(
      { minX: -1, minY: 2, maxX: 5, maxY: -2 },
      100,
      100,
      { margin: FRAME_MARGIN_RATIO, maxSide: 64 },
    );

    expect(plan.extract.left).toBe(0);
    expect(plan.extract.top).toBe(99);
    expect(plan.extract.width).toBe(100);
    expect(plan.extract.height).toBe(1);
    expect(plan.side).toBe(Math.round(100 * (1 + FRAME_MARGIN_RATIO * 2)));
    expect(plan.resizeSide).toBe(64);
  });

  test("keeps the default maximum at 384 pixels", () => {
    const plan = planFrameCrop({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 1000, 1000);
    expect(plan.resizeSide).toBe(MAX_NORMALIZED_SIDE);
  });
});
