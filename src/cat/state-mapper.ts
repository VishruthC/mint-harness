/**
 * Maps Mint agent activity to cat animation states.
 *
 * The mapper is a pure state machine over an injected clock: the TUI feeds it
 * real events and the animation clock ticks it. It never schedules timers.
 *
 * Two layers are tracked:
 *
 * - `state` is what the cat is showing right now (possibly a one-shot).
 * - `baseState` is the latest looping activity underneath. When a one-shot
 *   finishes, the cat returns to this state with its original entry time, so a
 *   response that is still streaming resumes in place instead of snapping to
 *   idle.
 */
import type { CatAnimation, CatManifest, CatState } from "./types.ts";
import { effectiveAnimation } from "./manifest.ts";
import { isOneShotState, oneShotMs, statePriority } from "./animator.ts";

const READ_TOOLS = new Set(["workspace_read", "workspace_search"]);
const WRITE_TOOLS = new Set(["workspace_propose_write", "workspace_propose_patch"]);

export type ActivityEvent =
  | { type: "sessionStarted" }
  | { type: "sessionWaiting" }
  | { type: "modelThinking" }
  | { type: "responseStreaming" }
  | { type: "toolStarted"; toolName: string }
  | { type: "operationCompleted" }
  | { type: "operationFailed" }
  | { type: "cancelled" };

export interface CatActivity {
  state: CatState;
  sinceMs: number;
  /** Latest looping activity, used when a one-shot completes. */
  baseState: CatState;
  baseSinceMs: number;
  /** Monotonic version used by callers to skip redundant work. */
  revision: number;
}

export class StateMapper {
  private manifest: CatManifest | null = null;
  private visibleState: CatState = "idle";
  private visibleSinceMs = 0;
  private baseState: CatState = "idle";
  private baseSinceMs = 0;
  private revision = 0;
  private current: CatActivity = {
    state: "idle",
    sinceMs: 0,
    baseState: "idle",
    baseSinceMs: 0,
    revision: 0,
  };

  setManifest(manifest: CatManifest | null) {
    this.manifest = manifest;
  }

  get activity(): CatActivity {
    return this.current;
  }

  private animationFor(state: CatState): CatAnimation {
    if (this.manifest) return effectiveAnimation(this.manifest, state);
    return { frames: [], fps: 2, loop: true };
  }

  private isOneShot(state: CatState): boolean {
    return isOneShotState(state, this.manifest?.animations[state]);
  }

  private commit(): CatActivity {
    this.revision += 1;
    this.current = {
      state: this.visibleState,
      sinceMs: this.visibleSinceMs,
      baseState: this.baseState,
      baseSinceMs: this.baseSinceMs,
      revision: this.revision,
    };
    return this.current;
  }

  /** Update the latest looping activity without restarting an identical state. */
  private setBase(state: CatState, nowMs: number): boolean {
    if (this.baseState === state) return false;
    this.baseState = state;
    this.baseSinceMs = nowMs;
    return true;
  }

  private enterVisible(state: CatState, sinceMs: number): boolean {
    if (this.visibleState === state) return false;
    this.visibleState = state;
    this.visibleSinceMs = sinceMs;
    return true;
  }

  handle(event: ActivityEvent, nowMs: number): CatActivity {
    // Settle an expired one-shot before applying a new event.
    this.tick(nowMs);

    if (event.type === "cancelled") {
      let changed = this.setBase("idle", nowMs);
      // Cancellation is explicit user intent: it always settles immediately,
      // even if a high-priority failure/success one-shot was on screen.
      if (this.visibleState !== "idle") {
        this.visibleState = "idle";
        this.visibleSinceMs = nowMs;
        changed = true;
      }
      return changed ? this.commit() : this.current;
    }

    const nextState = this.stateFor(event);
    if (!nextState) return this.current;

    const currentIsOneShot = this.isOneShot(this.visibleState);
    const nextIsOneShot = this.isOneShot(nextState);

    if (nextIsOneShot) {
      if (this.visibleState === nextState) {
        // Repeated identical events never restart the same one-shot.
        return this.current;
      }
      if (currentIsOneShot && statePriority(nextState) <= statePriority(this.visibleState)) {
        // A lower-priority one-shot must not cut off the active one.
        return this.current;
      }
      this.enterVisible(nextState, nowMs);
      return this.commit();
    }

    // Looping activity always reflects the latest real event. If a one-shot is
    // on screen, only the underlying state changes; the one-shot plays out.
    let changed = this.setBase(nextState, nowMs);
    if (!currentIsOneShot) {
      changed = this.enterVisible(nextState, nowMs) || changed;
    }
    return changed ? this.commit() : this.current;
  }

  private stateFor(event: Exclude<ActivityEvent, { type: "cancelled" }>): CatState | null {
    switch (event.type) {
      case "sessionStarted":
        return "hi";
      case "sessionWaiting":
        return "idle";
      case "modelThinking":
        return "think";
      case "responseStreaming":
        return "talk";
      case "toolStarted":
        if (READ_TOOLS.has(event.toolName)) return "read";
        if (WRITE_TOOLS.has(event.toolName)) return "write";
        return "tool";
      case "operationCompleted":
        return "success";
      case "operationFailed":
        return "failure";
    }
  }

  /**
   * Settle a finished one-shot into the latest underlying working state (or
   * idle). The underlying entry time is preserved so looping motion does not
   * restart from frame 1.
   */
  tick(nowMs: number): CatActivity {
    if (!this.isOneShot(this.visibleState)) return this.current;
    const animation = this.animationFor(this.visibleState);
    if (nowMs - this.visibleSinceMs < oneShotMs(animation)) return this.current;

    this.visibleState = this.baseState;
    this.visibleSinceMs = this.baseSinceMs;
    return this.commit();
  }
}
