/**
 * Pure frame clock for cat animations.
 *
 * Given the current state, when the state was entered, and the manifest FPS,
 * returns the active frame index. Looping states wrap; one-shot states clamp
 * at the last frame and signal completion via `settled` so the state mapper
 * can return to idle. No timers or IO: callers drive it from the existing
 * render loop, so nothing fights OpenTUI.
 */
import type { CatAnimation } from "./types.ts";

export interface FrameSelection {
  index: number;
  settled: boolean;
}

export function frameAt(animation: CatAnimation, enteredAtMs: number, nowMs: number, blink: boolean): FrameSelection {
  const frames = animation.frames.length;
  if (frames === 0) return { index: 0, settled: true };
  if (animation.fps <= 0) return { index: 0, settled: !animation.loop };
  const step = Math.max(0, nowMs - enteredAtMs);
  const position = Math.floor((step * animation.fps) / 1000);
  if (animation.loop) {
    let index = position % frames;
    if (blink && frames > 1) index = Math.min(frames - 1, index + 1);
    return { index, settled: false };
  }
  if (position >= frames) return { index: frames - 1, settled: true };
  return { index: position, settled: false };
}

export function frameIntervalMs(animation: CatAnimation): number {
  return animation.fps > 0 ? Math.round(1000 / animation.fps) : 1000;
}

/**
 * Totally pure one-shot duration helper for state transitions.
 * `holdMs` (if set) wins; otherwise one pass at the animation FPS.
 */
export function oneShotMs(animation: CatAnimation, fallback = 1800): number {
  if (typeof animation.holdMs === "number" && animation.holdMs > 0) return animation.holdMs;
  return Math.max(fallback, Math.round((animation.frames.length * 1000) / Math.max(1, animation.fps)));
}
