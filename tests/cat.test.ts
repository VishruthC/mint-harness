import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, loadPack, effectiveAnimation, framePath, assetsRoot, packDir, assetsRootCandidates, chooseAssetsRoot } from "../src/cat/manifest";
import { NativeImage } from "@opentui/core";
import {
  animationFps,
  frameAt,
  frameAtTransition,
  isOneShotState,
  oneShotMs,
  statePriority,
} from "../src/cat/animator";
import { StateMapper, type ActivityEvent } from "../src/cat/state-mapper";
import { CatClock, type ClockTimers } from "../src/cat/clock";
import { decideRenderer } from "../src/cat/terminal-detection";
import type { CatManifest, CatState } from "../src/cat/types";

let dir = "";
function tmp() {
  dir = mkdtempSync(join(tmpdir(), "mint-cat-"));
  return dir;
}

const TEST_MANIFEST: CatManifest = {
  name: "test",
  version: 1,
  dimensions: { width: 128, height: 128 },
  animations: {
    idle: { frames: ["idle/1.png", "idle/2.png"], fps: 2, loop: true },
    hi: { frames: ["hi/1.png", "hi/2.png"], fps: 2, loop: false, holdMs: 100 },
    think: { frames: ["think/1.png"], fps: 2, loop: true },
    talk: { frames: ["talk/1.png", "talk/2.png", "talk/3.png"], fps: 4, loop: true },
    read: { frames: ["read/1.png"], fps: 2, loop: true },
    write: { frames: ["write/1.png"], fps: 2, loop: true },
    tool: { frames: ["tool/1.png", "tool/2.png"], fps: 2, loop: true },
    success: { frames: ["success/1.png", "success/2.png"], fps: 2, loop: false, holdMs: 200 },
    failure: { frames: ["failure/1.png", "failure/2.png"], fps: 2, loop: false, holdMs: 200 },
  },
};

function mapperWith(manifest: CatManifest = TEST_MANIFEST): StateMapper {
  const mapper = new StateMapper();
  mapper.setManifest(manifest);
  return mapper;
}

describe("cat manifest", () => {
  test("parses the bundled default pack", () => {
    const pack = loadPack("default");
    expect(pack.ok).toBe(true);
    expect(pack.manifest.animations.idle?.frames.length).toBeGreaterThan(0);
    expect(pack.manifest.dimensions).toEqual({ width: 128, height: 128 });
    expect(effectiveAnimation(pack.manifest, "tool").frames.length).toBeGreaterThan(0);
  });

  test("preserves the existing manifest schema for every shipped state", () => {
    const pack = loadPack("default");
    expect(Object.keys(pack.manifest.animations).sort()).toEqual([
      "failure",
      "hi",
      "idle",
      "read",
      "success",
      "talk",
      "think",
      "tool",
      "write",
    ]);
    for (const animation of Object.values(pack.manifest.animations)) {
      expect(Array.isArray(animation?.frames)).toBe(true);
      expect(animation?.frames.length).toBeGreaterThan(0);
      expect(animation?.fps).toBeGreaterThan(0);
      expect(typeof animation?.loop).toBe("boolean");
    }
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

  test("finds shipped assets from both source and bundled layouts", () => {
    const root = mkdtempSync(join(tmpdir(), "mint-cat-root-"));
    try {
      const sourceCat = join(root, "src", "cat");
      const assets = join(sourceCat, "assets");
      const dist = join(root, "dist");
      mkdirSync(assets, { recursive: true });
      mkdirSync(dist, { recursive: true });

      expect(chooseAssetsRoot(assetsRootCandidates(sourceCat))).toBe(assets);
      expect(chooseAssetsRoot(assetsRootCandidates(dist))).toBe(assets);
      expect(chooseAssetsRoot([join(root, "missing"), assets])).toBe(assets);
      expect(chooseAssetsRoot([join(root, "missing")])).toBe(join(root, "missing"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  test("supports variable and empty frame counts", () => {
    const two = { frames: ["a", "b"], fps: 2, loop: true };
    const four = { frames: ["a", "b", "c", "d"], fps: 2, loop: true };
    expect(frameAt(two, 0, 1000, false).index).toBe(0);
    expect(frameAt(four, 0, 1000, false).index).toBe(2);
    expect(frameAt({ frames: [], fps: 2, loop: true }, 0, 5000, false)).toEqual({ index: 0, settled: true });
    expect(frameAt({ frames: ["a"], fps: 0, loop: false }, 0, 5000, false)).toEqual({ index: 0, settled: true });
  });

  test("one-shot duration honors holdMs", () => {
    expect(oneShotMs({ frames: ["a"], fps: 1, loop: false, holdMs: 2200 })).toBe(2200);
    expect(oneShotMs({ frames: ["a", "b", "c"], fps: 2, loop: false })).toBe(1800);
  });

  test("transition holds the outgoing frame then starts the incoming first frame", () => {
    const from = { frames: ["a", "b"], fps: 10, loop: true };
    const to = { frames: ["x", "y", "z"], fps: 10, loop: true };
    const transition = {
      startedAtMs: 1000,
      durationMs: 100,
      fromEnteredAtMs: 900,
      toEnteredAtMs: 1100,
    };
    // The outgoing frame is frozen for the whole hold window.
    expect(frameAtTransition(from, to, transition, 1050)).toMatchObject({ phase: "from", index: 1 });
    expect(frameAtTransition(from, to, transition, 1099)).toMatchObject({ phase: "from", index: 1 });
    expect(frameAtTransition(from, to, transition, 1100)).toMatchObject({ phase: "to", index: 0 });
    expect(frameAtTransition(from, to, transition, 1200)).toMatchObject({ phase: "to", index: 1 });
  });

  test("zero-duration transitions switch immediately and empty states never blank", () => {
    const from = { frames: ["a"], fps: 2, loop: true };
    const to = { frames: ["x", "y"], fps: 2, loop: true };
    const immediate = {
      startedAtMs: 1000,
      durationMs: 0,
      fromEnteredAtMs: 0,
      toEnteredAtMs: 1000,
    };
    expect(frameAtTransition(from, to, immediate, 1000)).toMatchObject({ phase: "to", index: 0 });
    const empty = { frames: [], fps: 2, loop: true };
    expect(frameAtTransition(empty, to, {
      startedAtMs: 1000,
      durationMs: 100,
      fromEnteredAtMs: 0,
      toEnteredAtMs: 1100,
    }, 1050)).toMatchObject({ phase: "to", index: 0 });
  });

  test("resumes an underlying animation on its original clock", () => {
    const from = { frames: ["a"], fps: 2, loop: false, holdMs: 200 };
    const to = { frames: ["x", "y", "z"], fps: 2, loop: true };
    expect(frameAtTransition(from, to, {
      startedAtMs: 2200,
      durationMs: 100,
      fromEnteredAtMs: 2000,
      toEnteredAtMs: 0,
    }, 2300)).toMatchObject({ phase: "to", index: 1 }); // 2.3s * 2fps = frame 4, wraps to 1
  });

  test("resolves configurable FPS overrides without mutating the manifest", () => {
    const idle = { frames: ["a", "b"], fps: 2, loop: true };
    const oneShot = { frames: ["a", "b"], fps: 2, loop: false, holdMs: 200 };
    expect(animationFps("idle", idle)).toBe(2);
    expect(animationFps("idle", idle, { idleFps: 5 })).toBe(5);
    expect(animationFps("talk", idle, { workingFps: 6 })).toBe(6);
    expect(animationFps("think", idle, { workingFps: 6 })).toBe(2);
    expect(animationFps("success", oneShot, { oneShotSpeed: 2 })).toBe(4);
    expect(animationFps("idle", idle, { animation: false })).toBe(0);
    expect(idle.fps).toBe(2);
  });

  test("state priorities are deterministic", () => {
    expect(statePriority("failure")).toBeGreaterThan(statePriority("success"));
    expect(statePriority("success")).toBeGreaterThan(statePriority("hi"));
    expect(statePriority("hi")).toBeGreaterThan(statePriority("think"));
    expect(statePriority("think")).toBeGreaterThan(statePriority("read"));
    expect(statePriority("read")).toBeGreaterThan(statePriority("write"));
    expect(statePriority("write")).toBeGreaterThan(statePriority("talk"));
    expect(statePriority("talk")).toBeGreaterThan(statePriority("idle"));
    expect(isOneShotState("success")).toBe(true);
    expect(isOneShotState("success", { frames: ["a"], fps: 2, loop: true })).toBe(false);
    expect(isOneShotState("think")).toBe(false);
  });
});

describe("cat state mapper", () => {
  test("maps every agent event to the expected state", () => {
    const mapper = mapperWith();
    expect(mapper.handle({ type: "sessionStarted" }, 0).state).toBe("hi");
    expect(mapper.tick(100).state).toBe("idle");
    expect(mapper.handle({ type: "sessionWaiting" }, 200).state).toBe("idle");
    expect(mapper.handle({ type: "modelThinking" }, 300).state).toBe("think");
    expect(mapper.handle({ type: "responseStreaming" }, 400).state).toBe("talk");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_read" }, 500).state).toBe("read");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_search" }, 600).state).toBe("read");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_propose_write" }, 700).state).toBe("write");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_propose_patch" }, 800).state).toBe("write");
    expect(mapper.handle({ type: "toolStarted", toolName: "terminal_propose" }, 900).state).toBe("tool");

    expect(mapper.handle({ type: "operationCompleted" }, 1000).state).toBe("success");
    expect(mapper.handle({ type: "operationFailed" }, 1100).state).toBe("failure");
  });

  test("looping states never settle", () => {
    const cases: Array<[ActivityEvent, CatState]> = [
      [{ type: "modelThinking" }, "think"],
      [{ type: "responseStreaming" }, "talk"],
      [{ type: "toolStarted", toolName: "workspace_read" }, "read"],
      [{ type: "toolStarted", toolName: "workspace_propose_write" }, "write"],
      [{ type: "toolStarted", toolName: "terminal_propose" }, "tool"],
      [{ type: "sessionWaiting" }, "idle"],
    ];
    for (const [event, expected] of cases) {
      const mapper = mapperWith();
      expect(mapper.handle(event, 0).state).toBe(expected);
      expect(mapper.tick(999_999).state).toBe(expected);
    }
  });

  test("one-shots play their full hold window then settle", () => {
    const success = mapperWith();
    success.handle({ type: "operationCompleted" }, 0);
    expect(success.tick(199).state).toBe("success");
    expect(success.tick(200).state).toBe("idle");

    const failure = mapperWith();
    failure.handle({ type: "operationFailed" }, 0);
    expect(failure.tick(199).state).toBe("failure");
    expect(failure.tick(200).state).toBe("idle");

    const hi = mapperWith();
    hi.handle({ type: "sessionStarted" }, 0);
    expect(hi.tick(99).state).toBe("hi");
    expect(hi.tick(100).state).toBe("idle");
  });

  test("returns to the underlying working state and preserves its clock", () => {
    const mapper = mapperWith();
    mapper.handle({ type: "modelThinking" }, 0);
    mapper.handle({ type: "operationCompleted" }, 100);
    expect(mapper.activity.state).toBe("success");
    expect(mapper.activity.baseState).toBe("think");
    expect(mapper.tick(299).state).toBe("success");
    const resumed = mapper.tick(300);
    expect(resumed.state).toBe("think");
    expect(resumed.sinceMs).toBe(0);
  });

  test("underlying activity keeps updating while a one-shot is visible", () => {
    const mapper = mapperWith();
    mapper.handle({ type: "modelThinking" }, 0);
    mapper.handle({ type: "operationCompleted" }, 100);
    mapper.handle({ type: "responseStreaming" }, 150);
    expect(mapper.activity.state).toBe("success");
    expect(mapper.activity.baseState).toBe("talk");
    expect(mapper.tick(300).state).toBe("talk");
  });

  test("follows a realistic tool round and returns to the right working state", () => {
    const mapper = mapperWith();
    expect(mapper.handle({ type: "sessionStarted" }, 0).state).toBe("hi");
    expect(mapper.tick(100).state).toBe("idle");
    expect(mapper.handle({ type: "modelThinking" }, 200).state).toBe("think");
    expect(mapper.handle({ type: "responseStreaming" }, 300).state).toBe("talk");
    expect(mapper.handle({ type: "toolStarted", toolName: "workspace_propose_write" }, 400).state).toBe("write");
    expect(mapper.handle({ type: "operationCompleted" }, 500).state).toBe("success");
    // The next model round starts underneath the celebration.
    expect(mapper.handle({ type: "modelThinking" }, 600).state).toBe("success");
    expect(mapper.activity.baseState).toBe("think");
    expect(mapper.tick(700).state).toBe("think");
    expect(mapper.tick(700).sinceMs).toBe(600);
    expect(mapper.handle({ type: "responseStreaming" }, 800).state).toBe("talk");
    expect(mapper.handle({ type: "operationCompleted" }, 900).state).toBe("success");
    expect(mapper.handle({ type: "sessionWaiting" }, 950).state).toBe("success");
    expect(mapper.activity.baseState).toBe("idle");
    expect(mapper.tick(1100).state).toBe("idle");
  });

  test("success settles to idle when the turn is over", () => {
    const mapper = mapperWith();
    mapper.handle({ type: "operationCompleted" }, 0);
    mapper.handle({ type: "sessionWaiting" }, 10);
    expect(mapper.activity.state).toBe("success");
    expect(mapper.activity.baseState).toBe("idle");
    expect(mapper.tick(200).state).toBe("idle");
  });

  test("protects high-priority one-shots from lower-priority events", () => {
    const failure = mapperWith();
    failure.handle({ type: "operationFailed" }, 0);
    expect(failure.handle({ type: "operationCompleted" }, 10).state).toBe("failure");
    expect(failure.handle({ type: "sessionStarted" }, 20).state).toBe("failure");
    expect(failure.handle({ type: "modelThinking" }, 30).state).toBe("failure");
    expect(failure.activity.baseState).toBe("think");
    expect(failure.tick(200).state).toBe("think");

    const success = mapperWith();
    success.handle({ type: "operationCompleted" }, 0);
    expect(success.handle({ type: "sessionStarted" }, 10).state).toBe("success");
    expect(success.handle({ type: "modelThinking" }, 20).state).toBe("success");
    expect(success.activity.baseState).toBe("think");
    expect(success.tick(200).state).toBe("think");

    const hi = mapperWith();
    hi.handle({ type: "sessionStarted" }, 0);
    expect(hi.handle({ type: "modelThinking" }, 10).state).toBe("hi");
    expect(hi.tick(100).state).toBe("think");
  });

  test("a new failure interrupts success and hi", () => {
    const mapper = mapperWith();
    mapper.handle({ type: "operationCompleted" }, 0);
    expect(mapper.handle({ type: "operationFailed" }, 10).state).toBe("failure");
    expect(mapper.tick(210).state).toBe("idle");

    const greet = mapperWith();
    greet.handle({ type: "sessionStarted" }, 0);
    expect(greet.handle({ type: "operationFailed" }, 10).state).toBe("failure");
  });

  test("repeated identical events do not restart the same animation", () => {
    const oneShot = mapperWith();
    oneShot.handle({ type: "operationCompleted" }, 0);
    oneShot.handle({ type: "operationCompleted" }, 150);
    expect(oneShot.tick(200).state).toBe("idle");

    const looping = mapperWith();
    looping.handle({ type: "modelThinking" }, 0);
    expect(looping.activity.sinceMs).toBe(0);
    looping.handle({ type: "modelThinking" }, 50);
    expect(looping.activity.sinceMs).toBe(0);
  });

  test("cancellation settles immediately from any state", () => {
    const failure = mapperWith();
    failure.handle({ type: "operationFailed" }, 0);
    const settled = failure.handle({ type: "cancelled" }, 100);
    expect(settled.state).toBe("idle");
    expect(settled.baseState).toBe("idle");
    expect(settled.sinceMs).toBe(100);

    const working = mapperWith();
    working.handle({ type: "toolStarted", toolName: "workspace_read" }, 0);
    expect(working.handle({ type: "cancelled" }, 50).state).toBe("idle");
  });

  test("missing and empty optional animations never crash", () => {
    const minimal: CatManifest = {
      name: "minimal",
      version: 1,
      dimensions: { width: 128, height: 128 },
      animations: { idle: { frames: ["idle/1.png"], fps: 2, loop: true } },
    };
    const missing = mapperWith(minimal);
    expect(missing.handle({ type: "operationCompleted" }, 0).state).toBe("success");
    expect(missing.tick(1800).state).toBe("idle");

    const empty = mapperWith({
      name: "empty",
      version: 1,
      dimensions: { width: 128, height: 128 },
      animations: { idle: { frames: [], fps: 0, loop: true } },
    });
    expect(empty.handle({ type: "sessionWaiting" }, 0).state).toBe("idle");
    expect(empty.tick(9999).state).toBe("idle");
  });
});

describe("cat animation clock", () => {
  function fakeClock() {
    let scheduled = 0;
    let cleared = 0;
    let handler: (() => void) | null = null;
    const timers: ClockTimers = {
      setInterval: (fn) => {
        scheduled += 1;
        handler = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        cleared += 1;
      },
    };
    return {
      timers,
      counts: () => ({ scheduled, cleared }),
      fire: () => handler?.(),
    };
  }

  test("owns exactly one interval and cleans it up", () => {
    const fake = fakeClock();
    let ticks = 0;
    const clock = new CatClock(() => { ticks += 1; }, 100, fake.timers);
    clock.start();
    clock.start();
    expect(fake.counts().scheduled).toBe(1);
    fake.fire();
    expect(ticks).toBe(1);
    clock.stop();
    clock.stop();
    expect(fake.counts().cleared).toBe(1);
    expect(clock.running).toBe(false);
    clock.start();
    expect(fake.counts().scheduled).toBe(2);
    clock.dispose();
    expect(fake.counts().cleared).toBe(2);
    clock.start();
    expect(fake.counts().scheduled).toBe(2);
  });

  test("disabled companion never schedules an animation loop", () => {
    const fake = fakeClock();
    const clock = new CatClock(() => {}, 100, fake.timers);
    clock.setEnabled(false);
    clock.start();
    expect(fake.counts().scheduled).toBe(0);
    expect(clock.running).toBe(false);

    clock.setEnabled(true);
    clock.start();
    expect(fake.counts().scheduled).toBe(1);
    clock.setEnabled(false);
    expect(fake.counts().cleared).toBe(1);
    expect(clock.running).toBe(false);
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

describe("cat loop regression", () => {
  const SHIPPED = loadPack("default").manifest;
  const LOOPING_STATES = ["idle", "think", "talk", "read", "write", "tool"] as const;

  /** Mirror the widget's per-state playback resolution. */
  function looping(state: CatState, manifest: CatManifest = SHIPPED, options: Parameters<typeof animationFps>[2] = {}) {
    const base = effectiveAnimation(manifest, state);
    return { ...base, fps: animationFps(state, base, options) };
  }

  function distinct(values: number[]): number[] {
    return [...new Set(values)];
  }

  function hasWrap(values: number[], frameCount: number): boolean {
    return values.some((frame, index) => index > 0 && values[index - 1] === frameCount - 1 && frame === 0);
  }

  test("idle loops through all frames continuously", () => {
    const animation = looping("idle");
    expect(animation.frames).toHaveLength(2);
    expect(animation.fps).toBe(2);

    const seen: number[] = [];
    for (let now = 0; now <= 5000; now += 100) {
      seen.push(frameAt(animation, 0, now, false).index);
    }
    expect(distinct(seen)).toEqual([0, 1]);
    expect(hasWrap(seen, 2)).toBe(true);

    // Exact frame boundaries, not just "eventually changes".
    expect(frameAt(animation, 0, 0, false).index).toBe(0);
    expect(frameAt(animation, 0, 499, false).index).toBe(0);
    expect(frameAt(animation, 0, 500, false).index).toBe(1);
    expect(frameAt(animation, 0, 999, false).index).toBe(1);
    expect(frameAt(animation, 0, 1000, false).index).toBe(0);
  });

  test("think, talk, read, write and tool loop through every frame", () => {
    for (const state of ["think", "talk", "read", "write", "tool"] as const) {
      const animation = looping(state);
      const cycleMs = (animation.frames.length * 1000) / animation.fps;
      const seen: number[] = [];
      for (let now = 0; now <= cycleMs + 125; now += 25) {
        seen.push(frameAt(animation, 0, now, false).index);
      }
      expect(distinct(seen)).toEqual(animation.frames.map((_, index) => index));
      expect(hasWrap(seen, animation.frames.length)).toBe(true);
    }
  });

  test("a loop wraps from its final frame back to frame zero", () => {
    const animation = looping("talk");
    expect(animation.frames).toHaveLength(2);
    const cycleMs = (animation.frames.length * 1000) / animation.fps;
    expect(frameAt(animation, 0, cycleMs - 1, false).index).toBe(1);
    expect(frameAt(animation, 0, cycleMs, false).index).toBe(0);
    expect(frameAt(animation, 0, cycleMs + 1, false).index).toBe(0);
    expect(frameAt(animation, 0, cycleMs + 250, false).index).toBe(1);
  });

  test("states with different frame counts each cycle all of their frames", () => {
    const manifest: CatManifest = {
      name: "frame-counts",
      version: 1,
      dimensions: { width: 128, height: 128 },
      animations: {
        idle: { frames: ["a", "b"], fps: 4, loop: true },
        think: { frames: ["a", "b", "c"], fps: 4, loop: true },
        talk: { frames: ["a", "b", "c", "d", "e"], fps: 4, loop: true },
      },
    };
    const counts: Array<[CatState, number]> = [["idle", 2], ["think", 3], ["talk", 5]];
    for (const [state, count] of counts) {
      const animation = looping(state, manifest);
      expect(animation.frames).toHaveLength(count);
      const seen: number[] = [];
      for (let now = 0; now <= (count * 1000) / 4 + 125; now += 25) {
        seen.push(frameAt(animation, 0, now, false).index);
      }
      expect(distinct(seen)).toEqual(Array.from({ length: count }, (_, index) => index));
    }

    // The shipped pack currently uses 2-frame animations across all states.
    expect(looping("idle").frames).toHaveLength(2);
    expect(looping("talk").frames).toHaveLength(2);
  });

  test("each state uses its own configured FPS", () => {
    const think = looping("think");
    const talk = looping("talk");
    expect(think.fps).toBe(1.5);
    expect(talk.fps).toBe(4);
    expect(frameAt(think, 0, 667, false).index).toBe(1);
    // talk: 4 fps, 2 frames -> 250ms per frame, wraps every 500ms
    expect(frameAt(talk, 0, 250, false).index).toBe(1);
    expect(frameAt(talk, 0, 500, false).index).toBe(0);
    expect(frameAt(talk, 0, 750, false).index).toBe(1);
    expect(frameAt(talk, 0, 1000, false).index).toBe(0);

    // Overrides stay scoped to the documented states.
    const slowerRead = looping("read", SHIPPED, { workingFps: 1 });
    expect(slowerRead.fps).toBe(1);
    expect(frameAt(slowerRead, 0, 999, false).index).toBe(0);
    expect(frameAt(slowerRead, 0, 1000, false).index).toBe(1);
    expect(looping("think", SHIPPED, { workingFps: 1 }).fps).toBe(1.5);
  });

  test("looping survives an extended simulated session", () => {
    const durationMs = 10 * 60 * 1000;
    for (const state of LOOPING_STATES) {
      const animation = looping(state);
      const seen = new Set<number>();
      let wraps = 0;
      let previous = -1;
      for (let now = 0; now <= durationMs; now += 100) {
        const index = frameAt(animation, 0, now, false).index;
        seen.add(index);
        if (previous === animation.frames.length - 1 && index === 0) wraps += 1;
        previous = index;
      }
      expect(seen.size).toBe(animation.frames.length);
      expect(wraps).toBeGreaterThan(0);
    }
  });

  test("switching states does not break the next state's loop", () => {
    const mapper = mapperWith(SHIPPED);
    const think = looping("think");
    const talk = looping("talk");
    const read = looping("read");

    const thinking = mapper.handle({ type: "modelThinking" }, 0);
    expect(thinking.state).toBe("think");
    expect(frameAt(think, thinking.sinceMs, 700, false).index).toBe(1);

    const talking = mapper.handle({ type: "responseStreaming" }, 1500);
    expect(talking.state).toBe("talk");
    expect(talking.sinceMs).toBe(1500);
    const talkFrames: number[] = [];
    for (let now = 1500; now <= 2500; now += 50) {
      const activity = mapper.tick(now);
      expect(activity.state).toBe("talk");
      talkFrames.push(frameAt(talk, activity.sinceMs, now, false).index);
    }
    expect(distinct(talkFrames)).toEqual([0, 1]);
    expect(hasWrap(talkFrames, 2)).toBe(true);

    const reading = mapper.handle({ type: "toolStarted", toolName: "workspace_read" }, 2500);
    expect(reading.state).toBe("read");
    expect(reading.sinceMs).toBe(2500);
    const readFrames: number[] = [];
    for (let now = 2500; now <= 3250; now += 25) {
      readFrames.push(frameAt(read, reading.sinceMs, now, false).index);
    }
    expect(distinct(readFrames)).toEqual([0, 1]);
    expect(hasWrap(readFrames, 2)).toBe(true);
  });

  test("a one-shot interrupts a loop and restores it on its original clock", () => {
    const mapper = mapperWith(SHIPPED);
    const talk = looping("talk");
    const success = effectiveAnimation(SHIPPED, "success");

    const talking = mapper.handle({ type: "responseStreaming" }, 0);
    expect(talking.state).toBe("talk");
    expect(frameAt(talk, talking.sinceMs, 750, false).index).toBe(1);

    const celebrating = mapper.handle({ type: "operationCompleted" }, 500);
    expect(celebrating.state).toBe("success");
    expect(celebrating.baseState).toBe("talk");
    expect(frameAt(success, celebrating.sinceMs, 500, false).index).toBe(0);
    expect(frameAt(success, celebrating.sinceMs, 1499, false).index).toBe(1);
    expect(mapper.tick(2699).state).toBe("success");

    const restored = mapper.tick(2700);
    expect(restored.state).toBe("talk");
    expect(restored.sinceMs).toBe(0);
    // The talk loop resumes where it would have been, not frozen on frame 1.
    expect(frameAt(talk, restored.sinceMs, 2700, false).index).toBe(0);
    expect(frameAt(talk, restored.sinceMs, 2750, false).index).toBe(1);
    expect(frameAt(talk, restored.sinceMs, 3000, false).index).toBe(0);

    const resumed: number[] = [];
    for (let now = 2700; now <= 3800; now += 50) {
      resumed.push(frameAt(talk, restored.sinceMs, now, false).index);
    }
    expect([...new Set(resumed)].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(hasWrap(resumed, 2)).toBe(true);
  });

  test("repeated events neither restart nor stall a loop", () => {
    const mapper = mapperWith(SHIPPED);
    const think = looping("think");
    mapper.handle({ type: "modelThinking" }, 0);

    const seen: number[] = [];
    for (let now = 0; now <= 4000; now += 50) {
      const activity = mapper.handle({ type: "modelThinking" }, now);
      expect(activity.state).toBe("think");
      expect(activity.sinceMs).toBe(0);
      seen.push(frameAt(think, activity.sinceMs, now, false).index);
    }
    expect(distinct(seen)).toEqual([0, 1]);
    expect(hasWrap(seen, 2)).toBe(true);

    // Repeating a one-shot also never extends its hold window.
    const shots = mapperWith(SHIPPED);
    shots.handle({ type: "operationCompleted" }, 0);
    shots.handle({ type: "operationCompleted" }, 1000);
    expect(shots.tick(2199).state).toBe("success");
    expect(shots.tick(2200).state).toBe("idle");
  });

  test("pausing and resuming the clock does not permanently freeze a loop", () => {
    let handler: (() => void) | null = null;
    let scheduled = 0;
    let cleared = 0;
    const timers: ClockTimers = {
      setInterval: (fn) => {
        scheduled += 1;
        handler = fn;
        return scheduled as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        cleared += 1;
        handler = null;
      },
    };
    let phase = 0;
    const clock = new CatClock(() => { phase += 100; }, 100, timers);
    const idle = looping("idle");
    const fire = () => handler?.();

    clock.start();
    for (let index = 0; index < 10; index += 1) fire();
    expect(phase).toBe(1000);
    expect(frameAt(idle, 0, phase, false).index).toBe(0);

    clock.stop();
    expect(clock.running).toBe(false);
    for (let index = 0; index < 10; index += 1) fire();
    expect(phase).toBe(1000);

    clock.start();
    for (let index = 0; index < 5; index += 1) fire();
    expect(phase).toBe(1500);
    expect(frameAt(idle, 0, phase, false).index).toBe(1);
    for (let index = 0; index < 5; index += 1) fire();
    expect(phase).toBe(2000);
    expect(frameAt(idle, 0, phase, false).index).toBe(0);

    clock.dispose();
    expect(scheduled).toBe(2);
    expect(cleared).toBe(2);
  });
});

describe("default mascot pack runtime resolution", () => {
  const STATES: CatState[] = ["hi", "idle", "think", "talk", "read", "write", "tool", "success", "failure"];

  test("loads manifest, resolves and decodes all state frames independently of cwd", async () => {
    const prevAssets = process.env.MINT_CAT_ASSETS;
    delete process.env.MINT_CAT_ASSETS;
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const pack = loadPack("default");
      expect(pack.ok).toBe(true);
      expect(pack.error).toBeUndefined();
      expect(Object.keys(pack.manifest.animations).sort()).toEqual(STATES.slice().sort());

      const idle = effectiveAnimation(pack.manifest, "idle");
      expect(idle.frames).toEqual(["idle/frame-01.png", "idle/frame-02.png"]);
      for (const frame of idle.frames) {
        const resolved = framePath("default", frame);
        expect(resolved).not.toBe("");
        expect(existsSync(resolved)).toBe(true);
      }

      const uniqueResolved = new Set<string>();
      for (const state of STATES) {
        const animation = effectiveAnimation(pack.manifest, state);
        expect(animation.frames.length).toBeGreaterThan(0);
        for (const frame of animation.frames) {
          const resolved = framePath("default", frame);
          expect(resolved).not.toBe("");
          expect(existsSync(resolved)).toBe(true);
          uniqueResolved.add(resolved);
        }
      }

      expect([...uniqueResolved].sort()).toEqual(
        [
          join(packDir("default"), "hi", "frame-01.png"),
          join(packDir("default"), "hi", "frame-02.png"),
          join(packDir("default"), "idle", "frame-01.png"),
          join(packDir("default"), "idle", "frame-02.png"),
          join(packDir("default"), "read", "frame-01.png"),
          join(packDir("default"), "read", "frame-02.png"),
          join(packDir("default"), "think", "frame-01.png"),
          join(packDir("default"), "think", "frame-02.png"),
        ].sort(),
      );

      for (const resolved of uniqueResolved) {
        const bytes = new Uint8Array(readFileSync(resolved));
        const image = NativeImage.decode(bytes);
        expect(image.width).toBeGreaterThan(0);
        expect(image.height).toBeGreaterThan(0);
        image.dispose();
      }

      expect(assetsRoot()).not.toContain(process.cwd());
    } finally {
      process.chdir(originalCwd);
      if (prevAssets === undefined) delete process.env.MINT_CAT_ASSETS;
      else process.env.MINT_CAT_ASSETS = prevAssets;
    }
  });
});
