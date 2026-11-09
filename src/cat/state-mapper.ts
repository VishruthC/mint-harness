/**
 * Maps Mint agent activity to cat animation states.
 *
 * Pure function over explicit signals (no hidden timers or simulated activity):
 * the TUI feeds it real events — model reasoning, content streaming, tool
 * execution (by tool name), and operation outcomes. One-shot states (hi,
 * success, failure) expire after their manifest holdMs, then the mapper
 * returns to idle. A new operation always cancels an outdated one-shot.
 */
import type { CatAnimation, CatManifest, CatState } from "./types.ts";
import { effectiveAnimation } from "./manifest.ts";
import { oneShotMs } from "./animator.ts";

const READ_TOOLS = new Set(["workspace_read", "workspace_search"]);
const WRITE_TOOLS = new Set(["workspace_propose_write", "workspace_propose_patch"]);

export type ActivityEvent =
  | { type: "sessionStarted" }
  | { type: "sessionWaiting" }
  | { type: "modelThinking" }
  | { type: "responseStreaming" }
  | { type: "toolStarted"; toolName: string }
  | { type: "operationCompleted" }
  | { type: "operationFailed" };

export interface CatActivity {
  state: CatState;
  sinceMs: number;
}

export class StateMapper {
  private current: CatActivity = { state: "idle", sinceMs: 0 };
  private manifest: CatManifest | null = null;

  setManifest(manifest: CatManifest | null) {
    this.manifest = manifest;
  }

  get activity(): CatActivity {
    return this.current;
  }

  private enter(state: CatState, nowMs: number) {
    if (this.current.state === state) {
      // Same state re-entry still refreshes one-shot timers.
      this.current = { state, sinceMs: nowMs };
      return;
    }
    this.current = { state, sinceMs: nowMs };
  }

  handle(event: ActivityEvent, nowMs: number): CatActivity {
    switch (event.type) {
      case "sessionStarted":
        this.enter("hi", nowMs);
        break;
      case "sessionWaiting":
        this.enter("idle", nowMs);
        break;
      case "modelThinking":
        this.enter("think", nowMs);
        break;
      case "responseStreaming":
        this.enter("talk", nowMs);
        break;
      case "toolStarted":
        if (READ_TOOLS.has(event.toolName)) this.enter("read", nowMs);
        else if (WRITE_TOOLS.has(event.toolName)) this.enter("write", nowMs);
        else this.enter("tool", nowMs);
        break;
      case "operationCompleted":
        this.enter("success", nowMs);
        break;
      case "operationFailed":
        this.enter("failure", nowMs);
        break;
    }
    return this.tick(nowMs);
  }

  /** Settle one-shot states (hi/success/failure) back to idle. */
  tick(nowMs: number): CatActivity {
    const { state, sinceMs } = this.current;
    if (!["hi", "success", "failure"].includes(state)) return this.current;
    const animation: CatAnimation = this.manifest ? effectiveAnimation(this.manifest, state) : { frames: [], fps: 2, loop: false };
    if (nowMs - sinceMs >= oneShotMs(animation)) {
      this.current = { state: "idle", sinceMs: nowMs };
    }
    return this.current;
  }
}
