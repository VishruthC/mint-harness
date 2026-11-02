import { describe, expect, test } from "bun:test";
import {
  renderCatFrame,
  renderAllFrames,
  frameDiff,
  CAT_ART_SIZE,
  CAT_ART_FRAMES,
  type CatExpression,
  type CatMood,
} from "../src/cat-art";

const EXPRESSIONS: CatExpression[] = ["idle", "happy", "love", "zoomies", "wizard", "chaos"];
const MOODS: CatMood[] = ["idle", "curious", "thinking", "happy", "error", "zoomies", "sleepy", "love"];

describe("MINT cat art renderer", () => {
  test("default size buffer has correct dimensions", () => {
    const frame = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    expect(frame.length).toBe(CAT_ART_SIZE * CAT_ART_SIZE * 4);
  });

  test("custom size buffer has correct dimensions", () => {
    const size = 128;
    const frame = renderCatFrame({ expression: "idle", mood: "idle", frame: 0, size });
    expect(frame.length).toBe(size * size * 4);
  });

  test("center has visible pixels (cat body)", () => {
    const frame = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const centerIdx = (Math.floor(CAT_ART_SIZE / 2) * CAT_ART_SIZE + Math.floor(CAT_ART_SIZE / 2)) * 4;
    // Center should have non-zero alpha (cat body)
    expect(frame[centerIdx + 3]).toBeGreaterThan(0);
  });

  test("rendering is deterministic", () => {
    const a = renderCatFrame({ expression: "idle", mood: "idle", frame: 5 });
    const b = renderCatFrame({ expression: "idle", mood: "idle", frame: 5 });
    expect(a).toEqual(b);
  });

  test("all expressions render and produce distinct buffers", () => {
    const buffers = EXPRESSIONS.map((expr) => renderCatFrame({ expression: expr, mood: "idle", frame: 0 }));
    for (let i = 0; i < buffers.length; i++) {
      for (let j = i + 1; j < buffers.length; j++) {
        const diff = frameDiff(buffers[i], buffers[j]);
        expect(diff).toBeGreaterThan(0);
      }
    }
  });

  test("love expression has more pink/red pixels than idle", () => {
    const idle = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const love = renderCatFrame({ expression: "love", mood: "love", frame: 0 });

    let idlePink = 0;
    let lovePink = 0;
    for (let i = 0; i < idle.length; i += 4) {
      // Detect pinkish pixels (high R, medium G, high B)
      if (idle[i] > 200 && idle[i + 1] < 200 && idle[i + 2] > 180 && idle[i + 3] > 128) idlePink++;
      if (love[i] > 200 && love[i + 1] < 200 && love[i + 2] > 180 && love[i + 3] > 128) lovePink++;
    }
    expect(lovePink).toBeGreaterThan(idlePink);
  });

  test("wizard expression has gold/yellow pixels (hat star)", () => {
    const idle = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const wizard = renderCatFrame({ expression: "wizard", mood: "idle", frame: 0 });

    let idleGold = 0;
    let wizardGold = 0;
    for (let i = 0; i < idle.length; i += 4) {
      // Detect gold/yellow pixels (high R, high G, low B)
      if (idle[i] > 200 && idle[i + 1] > 180 && idle[i + 2] < 100 && idle[i + 3] > 128) idleGold++;
      if (wizard[i] > 200 && wizard[i + 1] > 180 && wizard[i + 2] < 100 && wizard[i + 3] > 128) wizardGold++;
    }
    expect(wizardGold).toBeGreaterThan(idleGold);
  });

  test("chaos expression has alert red pixels", () => {
    const idle = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const chaos = renderCatFrame({ expression: "chaos", mood: "idle", frame: 0 });

    let idleRed = 0;
    let chaosRed = 0;
    for (let i = 0; i < idle.length; i += 4) {
      // Detect alert red pixels (high R, low G, low B)
      if (idle[i] > 200 && idle[i + 1] < 100 && idle[i + 2] < 100 && idle[i + 3] > 128) idleRed++;
      if (chaos[i] > 200 && chaos[i + 1] < 100 && chaos[i + 2] < 100 && chaos[i + 3] > 128) chaosRed++;
    }
    expect(chaosRed).toBeGreaterThan(idleRed);
  });

  test("blink frame differs from open-eye frame", () => {
    // Frame 0 and 1 are blink frames (isBlinking = true)
    const blinkFrame = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const openFrame = renderCatFrame({ expression: "idle", mood: "idle", frame: 2 });
    const diff = frameDiff(blinkFrame, openFrame);
    expect(diff).toBeGreaterThan(0);
  });

  test("tail animation frames differ", () => {
    const frame0 = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const frame6 = renderCatFrame({ expression: "idle", mood: "idle", frame: 6 }); // Half cycle
    const diff = frameDiff(frame0, frame6);
    expect(diff).toBeGreaterThan(0);
  });

  test("all frames in a cycle are unique (at least some differences)", () => {
    const frames = renderAllFrames("idle", "idle");
    let uniqueCount = 0;
    for (let i = 0; i < frames.length; i++) {
      let isUnique = true;
      for (let j = 0; j < i; j++) {
        if (frameDiff(frames[i], frames[j]) === 0) {
          isUnique = false;
          break;
        }
      }
      if (isUnique) uniqueCount++;
    }
    // At least half the frames should be unique
    expect(uniqueCount).toBeGreaterThanOrEqual(CAT_ART_FRAMES / 2);
  });

  test("small test sizes work without out-of-bounds", () => {
    const sizes = [32, 64, 96, 128, 256];
    for (const size of sizes) {
      const frame = renderCatFrame({ expression: "idle", mood: "idle", frame: 0, size });
      expect(frame.length).toBe(size * size * 4);
      // Check no NaN or invalid values
      for (let i = 0; i < frame.length; i++) {
        expect(frame[i]).toBeGreaterThanOrEqual(0);
        expect(frame[i]).toBeLessThanOrEqual(255);
      }
    }
  });

  test("different moods produce different output for same expression", () => {
    const idle = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const happy = renderCatFrame({ expression: "idle", mood: "happy", frame: 0 });
    const sleepy = renderCatFrame({ expression: "idle", mood: "sleepy", frame: 0 });
    const error = renderCatFrame({ expression: "idle", mood: "error", frame: 0 });

    expect(frameDiff(idle, happy)).toBeGreaterThan(0);
    expect(frameDiff(idle, sleepy)).toBeGreaterThan(0);
    expect(frameDiff(idle, error)).toBeGreaterThan(0);
  });

  test("cat occupies reasonable portion of canvas (not tiny, not full)", () => {
    const frame = renderCatFrame({ expression: "idle", mood: "idle", frame: 0 });
    const size = CAT_ART_SIZE;
    let minX = size, minY = size, maxX = 0, maxY = 0, opaque = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (frame[(y * size + x) * 4 + 3] > 40) {
          opaque++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const coverage = opaque / (size * size);
    // Cat should occupy ~20-35% of canvas, bbox ~40-60% of canvas dimensions
    expect(coverage).toBeGreaterThan(0.15);
    expect(coverage).toBeLessThan(0.5);
    expect(w).toBeGreaterThan(size * 0.35);
    expect(w).toBeLessThan(size * 0.7);
    expect(h).toBeGreaterThan(size * 0.5);
    expect(h).toBeLessThan(size * 0.95);
    // Corners should be transparent
    expect(frame[3]).toBeLessThan(50);
    expect(frame[(size - 1) * 4 + 3]).toBeLessThan(50);
    expect(frame[(size * (size - 1)) * 4 + 3]).toBeLessThan(50);
    expect(frame[(size * size - 1) * 4 + 3]).toBeLessThan(50);
  });

  test("expression ID uniqueness", () => {
    expect(new Set(EXPRESSIONS).size).toBe(EXPRESSIONS.length);
  });
});

