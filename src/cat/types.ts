/** Shared types for the MINT cat companion. */

export const CAT_STATES = [
  "hi",
  "idle",
  "think",
  "talk",
  "read",
  "write",
  "tool",
  "success",
  "failure",
] as const;

export type CatState = (typeof CAT_STATES)[number];

export type CatRendererName = "auto" | "kitty" | "sixel" | "blocks" | "ascii";

export interface CatAnimation {
  frames: string[];
  fps: number;
  loop: boolean;
  holdMs?: number;
}

export interface CatManifest {
  name: string;
  version: number;
  dimensions: { width: number; height: number };
  animations: Partial<Record<CatState, CatAnimation>>;
}

export interface CatConfig {
  enabled: boolean;
  assetPack: string;
  renderer: CatRendererName;
  animation: boolean;
  scale: number;
  idleFps: number;
  workingFps: number;
  /** Hold time before a state switch draws the incoming first frame. */
  transitionMs: number;
  /** Multiplier for one-shot frame playback; 1 keeps manifest timing. */
  oneShotSpeed: number;
}

export interface CatEvent {
  kind:
    | "session.started"
    | "session.waiting"
    | "model.thinking"
    | "response.streaming"
    | "tool.read"
    | "tool.write"
    | "tool.executing"
    | "operation.completed"
    | "operation.failed";
  toolName?: string;
  ok?: boolean;
}
