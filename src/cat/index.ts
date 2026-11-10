/**
 * MINT cat companion.
 *
 * Manifest-driven PNG asset packs, an animation state mapper for real agent
 * activity, and an OpenTUI widget with ASCII fallback. See
 * `assets/README.md` for the exchange format and animation rules.
 */
export { loadPack, parseManifest, createImageCache, framePath, listPacks, assetsRoot, packDir, effectiveAnimation } from "./manifest.ts";
export {
  frameAt,
  frameAtTransition,
  frameIntervalMs,
  oneShotMs,
  animationFps,
  isOneShotState,
  statePriority,
  STATE_PRIORITY,
} from "./animator.ts";
export { StateMapper } from "./state-mapper.ts";
export type { ActivityEvent, CatActivity } from "./state-mapper.ts";
export { CatClock } from "./clock.ts";
export type { ClockTimers } from "./clock.ts";
export { decideRenderer } from "./terminal-detection.ts";
export { CatCompanion } from "./widget.tsx";
export type { CatCompanionProps } from "./widget.tsx";
export type { CatState, CatAnimation, CatManifest, CatRendererName, CatConfig } from "./types.ts";
