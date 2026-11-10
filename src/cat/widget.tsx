/**
 * MINT cat companion widget.
 *
 * Renders the active asset-pack frame as a real PNG via OpenTUI's `<image>`
 * element (Kitty/Sixel/blocks negotiated by OpenTUI), above a full-width
 * divider, paws resting on the divider. Frames are decoded once and cached;
 * swapping states never re-reads disk. Falls back to the existing pixel
 * renderer when image rendering is disabled or unsupported.
 *
 * State changes use a clean frame-boundary transition: the outgoing frame is
 * held for `transitionMs`, then the incoming state starts on its first frame.
 * Terminal image protocols cannot alpha-blend two pictures, so there is no
 * fake crossfade and no extra redraw loop.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { NativeImage } from "@opentui/core";
import { effectiveAnimation, framePath, loadPack, type LoadedPack } from "./manifest.ts";
import { animationFps, frameAt, frameAtTransition } from "./animator.ts";
import { decideRenderer } from "./terminal-detection.ts";
import type { CatActivity } from "./state-mapper.ts";
import type { CatRendererName, CatAnimation, CatState } from "./types.ts";
import { CAT_STATES } from "./types.ts";
import { renderCatPixels, type CatCell, type CatPalette } from "../cat-line-art.ts";

export interface CatCompanionProps {
  width: number;
  height?: number;
  state: CatState;
  /** Mapper activity. When present, preserves entry timing across transitions. */
  activity?: CatActivity;
  /** Animation clock in milliseconds, driven by the existing phase ticker. */
  phase: number;
  enabled: boolean;
  pack: string;
  renderer: CatRendererName;
  animation: boolean;
  scale: number;
  idleFps: number;
  workingFps: number;
  /** Hold the outgoing frame this long before drawing the incoming first frame. */
  transitionMs?: number;
  /** Multiplier for one-shot frame playback. */
  oneShotSpeed?: number;
  colors: {
    divider: string;
    ascii: CatPalette;
  };
}

type LoadedImage = { path: string; image: NativeImage };

type Span = { text: string; fg: string; bg: string };

function toSpans(cells: CatCell[]): Span[] {
  const spans: Span[] = [];
  for (const cell of cells) {
    const last = spans[spans.length - 1];
    if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch;
    else spans.push({ text: cell.ch, fg: cell.fg, bg: cell.bg });
  }
  return spans;
}

interface DisplayState {
  state: CatState;
  sinceMs: number;
}

interface ActiveTransition {
  fromState: CatState;
  fromSinceMs: number;
  toState: CatState;
  toSinceMs: number;
  /** Entry used after the hold. Normal changes start here; resumed states keep their clock. */
  toEnteredAtMs: number;
  startedAtMs: number;
  durationMs: number;
}

/** A manifest animation with its effective FPS and resolved file paths. */
interface PlaybackAnimation extends CatAnimation {
  paths: string[];
}

type Playback = Record<CatState, PlaybackAnimation>;

interface Selection {
  state: CatState;
  index: number;
  path: string;
}

const EMPTY_ANIMATION: CatAnimation = { frames: [], fps: 2, loop: true };
const FALLBACK_STATE: Record<CatState, "idle" | "thinking" | "working" | "success"> = {
  hi: "success",
  idle: "idle",
  think: "thinking",
  talk: "working",
  read: "working",
  write: "working",
  tool: "working",
  success: "success",
  failure: "idle",
};

function buildPlayback(pack: LoadedPack | null, name: string, props: CatCompanionProps): Playback {
  const result = {} as Playback;
  for (const state of CAT_STATES) {
    const base = pack ? effectiveAnimation(pack.manifest, state) : EMPTY_ANIMATION;
    result[state] = {
      ...base,
      fps: animationFps(state, base, {
        animation: props.animation,
        idleFps: props.idleFps,
        workingFps: props.workingFps,
        oneShotSpeed: props.oneShotSpeed,
      }),
      // Resolve once per state, not on every 100 ms animation tick. The
      // manifest loader already rejected frames that do not exist.
      paths: base.frames.map((frame) => (pack ? framePath(name, frame) : "")),
    };
  }
  return result;
}

export function CatCompanion(props: CatCompanionProps) {
  const renderer = useRenderer();
  const [packData, setPackData] = createSignal<LoadedPack | null>(null);
  const [current, setCurrent] = createSignal<LoadedImage | undefined>(undefined);
  const [display, setDisplay] = createSignal<DisplayState>({
    state: props.activity?.state ?? props.state,
    sinceMs: props.activity?.sinceMs ?? props.phase,
  });
  const [transition, setTransition] = createSignal<ActiveTransition | null>(null);
  let legacyState = props.state;
  let legacySince = props.phase;
  let disposed = false;

  // Decoded frames and in-flight loads belong to this mount. Keeping the cache
  // per instance makes cleanup safe and avoids disposing images another widget
  // may still be showing.
  const images = new Map<string, LoadedImage>();
  const pending = new Map<string, Promise<LoadedImage | undefined>>();

  // Decode at most once per path. The in-flight map deduplicates the animation
  // effect, the prefetcher, and rapid state changes that ask for the same
  // frame before its read/decode has finished.
  const ensureImage = (path: string): Promise<LoadedImage | undefined> => {
    const cached = images.get(path);
    if (cached) return Promise.resolve(cached);
    const inFlight = pending.get(path);
    if (inFlight) return inFlight;
    const task = (async () => {
      try {
        const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
        if (disposed) return undefined;
        const image = NativeImage.decode(bytes);
        if (disposed) {
          image.dispose();
          return undefined;
        }
        const loaded: LoadedImage = { path, image };
        images.set(path, loaded);
        return loaded;
      } catch {
        // Missing/unreadable frame: keep the nearest valid frame on screen.
        return undefined;
      } finally {
        pending.delete(path);
      }
    })();
    pending.set(path, task);
    return task;
  };

  createEffect(() => {
    const pack = props.pack;
    setPackData(loadPack(pack));
  });

  // Notice state changes and start a transition. Display is read untracked so
  // finishing a transition does not trigger a second, redundant transition.
  createEffect(() => {
    const activity = props.activity;
    const state = activity?.state ?? props.state;
    let sinceMs: number;
    if (activity) {
      sinceMs = activity.sinceMs;
    } else {
      if (state !== legacyState) {
        legacyState = state;
        legacySince = untrack(() => props.phase);
      }
      sinceMs = legacySince;
    }

    const shown = untrack(display);
    const active = untrack(transition);
    // Only a state change starts a transition. Underlying-state updates can
    // produce a new activity object with the same visible state; those must not
    // restart the animation or rewind its entry time.
    if (state === shown.state) {
      if (active && active.toState !== state) setTransition(null);
      return;
    }
    if (active && active.toState === state && active.toSinceMs === sinceMs) return;

    const now = untrack(() => props.phase);
    const duration = Math.max(0, untrack(() => props.transitionMs ?? 100));
    if (duration <= 0) {
      setDisplay({ state, sinceMs });
      setTransition(null);
      return;
    }
    const toEnteredAtMs = sinceMs < now ? sinceMs : now + duration;
    setTransition({
      fromState: shown.state,
      fromSinceMs: shown.sinceMs,
      toState: state,
      toSinceMs: sinceMs,
      toEnteredAtMs,
      startedAtMs: now,
      durationMs: duration,
    });
  });

  // Finish a transition once its hold window has elapsed.
  createEffect(() => {
    const active = transition();
    if (!active) return;
    if (props.phase - active.startedAtMs < active.durationMs) return;
    setDisplay({ state: active.toState, sinceMs: active.toEnteredAtMs });
    setTransition(null);
  });

  const decision = createMemo(() => decideRenderer(props.renderer, renderer.capabilities));

  const playback = createMemo(() => buildPlayback(packData(), props.pack, props));

  // The selection is a new object only when the visible state, frame index, or
  // file path changes. Solid then skips downstream image work on the many ticks
  // that fall inside the same frame.
  const selection = createMemo(
    (): Selection => {
      if (!packData()) return { state: props.state, index: 0, path: "" };
      const active = transition();
      if (active) {
        const from = playback()[active.fromState];
        const to = playback()[active.toState];
        const selected = frameAtTransition(from, to, {
          startedAtMs: active.startedAtMs,
          durationMs: active.durationMs,
          fromEnteredAtMs: active.fromSinceMs,
          toEnteredAtMs: active.toEnteredAtMs,
        }, props.phase);
        const animation = selected.phase === "from" ? from : to;
        const path = animation.paths[selected.index] ?? animation.paths.find(Boolean) ?? "";
        return { state: selected.phase === "from" ? active.fromState : active.toState, index: selected.index, path };
      }
      const shown = display();
      const animation = playback()[shown.state];
      const selected = frameAt(animation, shown.sinceMs, props.phase, false);
      const path = animation.paths[selected.index] ?? animation.paths.find(Boolean) ?? "";
      return { state: shown.state, index: selected.index, path };
    },
    undefined,
    {
      equals: (a, b) => a.state === b.state && a.index === b.index && a.path === b.path,
    },
  );

  // Assets missing or invalid -> treat as ASCII regardless of renderer.
  const imageAvailable = createMemo(() => {
    if (!props.enabled) return false;
    if (decision().kind !== "image") return false;
    return selection().path !== "";
  });

  // This effect is keyed by the selected path, not by the clock. It runs at
  // most once per visible frame, and `ensureImage` prevents a slow decode from
  // being started again on every tick.
  createEffect(() => {
    const path = selection().path;
    if (!path || !imageAvailable()) {
      setCurrent(undefined);
      return;
    }
    const cached = images.get(path);
    if (cached) {
      setCurrent(cached);
      return;
    }
    // Keep the previous frame visible until this one is ready.
    void ensureImage(path).then((loaded) => {
      // A late decode must never rewind the loop to a frame the state has
      // already moved past.
      if (loaded && selection().path === path) setCurrent(loaded);
    });
  });

  // Warm the current (or incoming) state's frames one at a time. This makes
  // the first pass through a loop as smooth as later passes without decoding
  // every pack upfront or adding a second timer.
  const prefetchState = createMemo(() => transition()?.toState ?? selection().state);
  createEffect(() => {
    const state = prefetchState();
    if (!imageAvailable()) return;
    const paths = playback()[state].paths;
    if (paths.length < 2) return;
    void (async () => {
      for (const path of paths) {
        if (!path || disposed || prefetchState() !== state) break;
        await ensureImage(path);
      }
    })();
  });

  onCleanup(() => {
    disposed = true;
    for (const loaded of images.values()) {
      try { loaded.image.dispose(); } catch { /* already released */ }
    }
    images.clear();
    pending.clear();
  });

  const rows = createMemo((): number => {
    const budget = Math.max(2, Math.floor(props.height ?? 12));
    // Keep one row for the divider and never exceed the caller's height
    // budget. Very short terminals get a smaller cat rather than clipped rows.
    const maxRows = Math.max(1, budget - 1);
    return Math.max(1, Math.min(maxRows, Math.round(14 * props.scale)));
  });

  const imageWidth = createMemo(() => Math.max(1, Math.min(props.width, Math.round(rows() * 2))));
  const imageX = createMemo(() => Math.max(0, Math.floor((props.width - imageWidth()) / 2)));
  const divider = createMemo(() => "─".repeat(Math.max(0, props.width)));

  // Fallback whenever the image path cannot run (renderer=ascii, missing
  // pack, or no frames), so the cat never breaks the layout.
  const fallback = createMemo(() => {
    if (imageAvailable()) return null;
    return renderCatPixels({
      width: props.width,
      height: props.height,
      state: FALLBACK_STATE[props.state],
      // A disabled animation freezes the fallback too, not just image frames.
      phase: props.animation ? props.phase : 0,
      colors: props.colors.ascii,
    }).rows;
  });

  return (
    <Show when={props.enabled}>
      <box flexDirection="column" width="100%" minWidth={0} flexShrink={0} overflow="hidden">
        <Show
          when={imageAvailable()}
          fallback={
            <>
              {(fallback() ?? []).map((row) => {
                if (row.length && row.every((cell) => cell.ch === "─")) {
                  return <text fg={props.colors.divider} wrapMode="none" width="100%" minWidth={0} truncate={true}>{"─".repeat(row.length)}</text>;
                }
                return (
                  <text wrapMode="none" width="100%" minWidth={0} truncate={true}>
                    {toSpans(row).map((span) => <span style={{ fg: span.fg, bg: span.bg }}>{span.text}</span>)}
                  </text>
                );
              })}
            </>
          }
        >
          <box flexDirection="row" width="100%" minWidth={0} overflow="hidden">
            <box width={imageX()} minWidth={0} />
            <box width={imageWidth()} height={rows()} minWidth={0} flexShrink={0} overflow="hidden">
              <Show when={current()}>
                {(loaded) => <image source={loaded().image} width={imageWidth()} height={rows()} fit="fit" protocol={decision().protocol} />}
              </Show>
            </box>
          </box>
          <text fg={props.colors.divider} wrapMode="none" width="100%" minWidth={0} truncate={true}>
            {divider()}
          </text>
        </Show>
      </box>
    </Show>
  );
}
