/**
 * Pure frame clock and priority rules for cat animations.
 *
 * No timers or IO: callers drive this from the existing render loop, so nothing
 * fights OpenTUI. Two clocks are supported:
 *
 * - `frameAt` selects a frame from one state's animation.
 * - `frameAtTransition` holds the outgoing frame for a short, configurable
 *   transition window, then starts the incoming animation on its first frame.
 *   Terminal image protocols cannot crossfade, so this is a clean
 *   frame-boundary transition rather than a fake blend.
 */
import type { CatAnimation, CatState } from "./types.ts";

export interface FrameSelection {
  index: number;
  settled: boolean;
}

/**
 * Deterministic priority for interrupting a visible one-shot.
 *
 * Looping activity always follows the latest real event (think -> talk ->
 * read/write/tool), because that is what the agent is actually doing. These
 * priorities decide which one-shot owns the screen when events overlap.
 */
export const STATE_PRIORITY: Record<CatState, number> = {
  failure: 100,
  success: 90,
  hi: 80,
  think: 70,
  read: 60,
  write: 50,
  tool: 45,
  talk: 40,
  idle: 0,
};

const DEFAULT_ONE_SHOT_STATES = new Set<CatState>(["hi", "success", "failure"]);
const WORKING_FPS_STATES = new Set<CatState>(["talk", "read", "write", "tool"]);

export function statePriority(state: CatState): number {
  return STATE_PRIORITY[state] ?? 0;
}

/**
 * A state is a one-shot when its manifest animation says `loop: false`.
 * Missing optional animations fall back to the documented one-shot states.
 */
export function isOneShotState(state: CatState, animation?: CatAnimation | null): boolean {
  if (animation) return animation.loop === false;
  return DEFAULT_ONE_SHOT_STATES.has(state);
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

export interface FpsOptions {
  /** `false` freezes every animation on frame 1. */
  animation?: boolean;
  /** Overrides idle FPS when > 0. */
  idleFps?: number;
  /** Overrides talk/read/write/tool FPS when > 0. */
  workingFps?: number;
  /** Multiplies manifest FPS for one-shot states. Defaults to 1. */
  oneShotSpeed?: number;
}

/** Resolve the effective FPS for a state without mutating the manifest. */
export function animationFps(state: CatState, animation: CatAnimation, options: FpsOptions = {}): number {
  if (options.animation === false) return 0;
  let fps = animation.fps;
  if (animation.loop === false && typeof options.oneShotSpeed === "number" && options.oneShotSpeed > 0) {
    fps *= options.oneShotSpeed;
  }
  if (state === "idle" && typeof options.idleFps === "number" && options.idleFps > 0) {
    fps = options.idleFps;
  } else if (WORKING_FPS_STATES.has(state) && typeof options.workingFps === "number" && options.workingFps > 0) {
    fps = options.workingFps;
  }
  return Math.max(0, Math.min(60, fps));
}

export interface FrameTransition {
  /** Time the state change was noticed (the outgoing frame is held from here). */
  startedAtMs: number;
  /** How long to hold the outgoing frame. 0 switches immediately. */
  durationMs: number;
  /** Entry time of the outgoing state, so its frame clock keeps running. */
  fromEnteredAtMs: number;
  /**
   * Entry time of the incoming state. Normally the transition end, which shows
   * the incoming first frame. Returning to an older underlying state can pass
   * its original entry so its timing is preserved.
   */
  toEnteredAtMs?: number;
}

export interface TransitionFrameSelection extends FrameSelection {
  phase: "from" | "to";
}

/**
 * Select a frame during a state transition. There is deliberately no alpha
 * blending: image protocols either show a picture or they do not. Holding the
 * outgoing frame and swapping on a frame boundary avoids blank frames and
 * flicker while keeping redraw cost unchanged.
 */
export function frameAtTransition(
  from: CatAnimation,
  to: CatAnimation,
  transition: FrameTransition,
  nowMs: number,
  blink = false,
): TransitionFrameSelection {
  const duration = Math.max(0, transition.durationMs);
  const elapsed = Math.max(0, nowMs - transition.startedAtMs);
  if (duration > 0 && elapsed < duration && from.frames.length > 0) {
    // Freeze the outgoing frame for the whole hold so the swap is a single
    // clean frame boundary rather than an outgoing animation racing the switch.
    return { ...frameAt(from, transition.fromEnteredAtMs, transition.startedAtMs, blink), phase: "from" };
  }
  const entry = transition.toEnteredAtMs ?? transition.startedAtMs + duration;
  return { ...frameAt(to, entry, nowMs, blink), phase: "to" };
}
