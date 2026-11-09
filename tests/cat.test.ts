import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, loadPack, effectiveAnimation, framePath } from "../src/cat/manifest";
import { frameAt, oneShotMs } from "../src/cat/animator";
import { StateMapper } from "../src/cat/state-mapper";
import { decideRenderer } from "../src/cat/terminal-detection";

let dir = "";
function tmp() {
  dir = mkdtempSync(join(tmpdir(), "mint-cat-"));
  return dir;
}

describe("cat manifest", () => {
  test("parses the bundled default pack", () => {
    const pack = loadPack("default");
    expect(pack.ok).toBe(true);
    expect(pack.manifest.animations.idle?.frames.length).toBeGreaterThan(0);
    expect(pack.manifest.dimensions).toEqual({ width: 128, height: 128 });
    expect(effectiveAnimation(pack.manifest, "tool").frames.length).toBeGreaterThan(0);
  });

  test("falls back to idle for missing animations", () => {
    const manifest = parseManifest({
      name: "x",
      version: 1,
      dimensions: { width: 128, height: 128 },
      animations: { idle: { frames: ["a.png"], fps: 3, loop: true } },
    });
    expect(effectiveAnimation(manifest, "failure").frames).toEqual(["a.png"]);
  });

  test("rejects invalid manifests", () => {
    expect(() => parseManifest({ name: "x" })).toThrow();
    expect(() => parseManifest({ name: "x", dimensions: { width: -1, height: 128 }, animations: {} })).toThrow();
  });

  test("returns graceful fallback for missing packs", () => {
    const pack = loadPack("does-not-exist");
    expect(pack.ok).toBe(false);
    expect(pack.manifest.animations.idle?.frames).toEqual([]);
  });

  test("custom pack with a bad frame falls back cleanly", () => {
    const root = tmp();
    process.env.MINT_CAT_ASSETS = root;
    const packDir = join(root, "custom-cat");
    mkdirSync(join(packDir, "idle"), { recursive: true });
    writeFileSync(join(packDir, "idle", "real.png"), "fixture");
    writeFileSync(join(packDir, "manifest.json"), JSON.stringify({
      name: "Custom",
      dimensions: { width: 128, height: 128 },
      animations: {
        idle: { frames: ["idle/real.png"], fps: 2, loop: true },
        success: { frames: ["success/missing.png"], fps: 2, loop: false },
      },
    }));
    const pack = loadPack("custom-cat");
    expect(pack.ok).toBe(true);
    expect(pack.manifest.animations.success).toBeUndefined();
    expect(effectiveAnimation(pack.manifest, "success").frames).toEqual(["idle/real.png"]);
    delete process.env.MINT_CAT_ASSETS;
    rmSync(root, { recursive: true, force: true });
    dir = "";
  });

  test("framePath rejects traversal outside the pack", () => {
    expect(framePath("default", "../outside.png")).toBe("");
    expect(framePath("default", "/absolute.png")).toBe("");
  });
});

describe("cat animator", () => {
  test("loops looping animations and clamps one-shots", () => {
    const looping = { frames: ["a", "b", "c"], fps: 2, loop: true };
    expect(frameAt(looping, 1000, 1000, false).index).toBe(0);
    expect(frameAt(looping, 1000, 1600, false).index).toBe(1);
    expect(frameAt(looping, 1000, 3200, false).index).toBe(1); // wraps 4 % 3
    const oneShot = { frames: ["a", "b"], fps: 1, loop: false };
    expect(frameAt(oneShot, 0, 2500, false)).toEqual({ index: 1, settled: true });
  });

  test("one-shot duration honors holdMs", () => {
    expect(oneShotMs({ frames: ["a"], fps: 1, loop: false, holdMs: 2200 })).toBe(2200);
    expect(oneShotMs({ frames: ["a", "b", "c"], fps: 2, loop: false })).toBe(1800);
  });
});

describe("cat state mapper", () => {
  test("maps agent events to states and settles one-shots to idle", () => {
    const mapper = new StateMapper();
    expect(mapper.handle({ type: "sessionStarted" }, 1000).state).toBe("hi");
    expect(mapper.handle({ type: "modelThinking" }, 1100).state).toBe("think");
    expect(mapper.handle({ type: "responseStreaming" }, 1200).state).toBe("talk");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_read" }, 1300).state).toBe("read");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_propose_patch" }, 1400).state).toBe("write");
    expect(mapper.handle({ type: "toolStarted", toolName: "terminal_propose" }, 1500).state).toBe("tool");
    expect(mapper.handle({ type: "operationCompleted" }, 1600).state).toBe("success");
    expect(mapper.handle({ type: "operationFailed" }, 1700).state).toBe("failure");
  });

  test("settles success/failure after their hold window", () => {
    const mapper = new StateMapper();
    mapper.setManifest({
      name: "x",
      version: 1,
      dimensions: { width: 128, height: 128 },
      animations: {
        idle: { frames: [], fps: 2, loop: true },
        success: { frames: ["a"], fps: 2, loop: false, holdMs: 100 },
        failure: { frames: ["a"], fps: 2, loop: false, holdMs: 100 },
      },
    });
    mapper.handle({ type: "operationCompleted" }, 0);
    expect(mapper.tick(50).state).toBe("success");
    expect(mapper.tick(150).state).toBe("idle");
    mapper.handle({ type: "operationFailed" }, 1000);
    expect(mapper.tick(1150).state).toBe("idle");
    mapper.handle({ type: "sessionWaiting" }, 1200);
    expect(mapper.activity.state).toBe("idle");
  });

  test("a new operation cancels an outdated one-shot", () => {
    const mapper = new StateMapper();
    mapper.handle({ type: "operationCompleted" }, 0);
    expect(mapper.handle({ type: "modelThinking" }, 10).state).toBe("think");
  });
});

describe("cat terminal detection", () => {
  const caps = (kitty: boolean, sixel: boolean) => ({ kitty_graphics: kitty, sixel, kitty_keyboard: false, osc52_support: "unknown", multiplexer: "none", terminal: {} } as unknown as Parameters<typeof decideRenderer>[1]);

  test("picks kitty and sixel when detected", () => {
    expect(decideRenderer("auto", caps(true, false)).protocol).toBe("kitty");
    expect(decideRenderer("auto", caps(false, true)).protocol).toBe("sixel");
  });

  test("falls back to blocks on image-less terminals", () => {
    expect(decideRenderer("auto", caps(false, false)).protocol).toBe("blocks");
  });

  test("ascii override and no-detection behaviors hold", () => {
    expect(decideRenderer("ascii", caps(true, false)).kind).toBe("ascii");
    expect(decideRenderer("auto", null).protocol).toBe("auto");
    expect(decideRenderer("kitty", caps(false, false)).protocol).toBe("auto");
  });
});
