/**
 * MINT cat companion widget.
 *
 * Renders the active asset-pack frame as a real PNG via OpenTUI's `<image>`
 * element (Kitty/Sixel/blocks negotiated by OpenTUI), above a full-width
 * divider, paws resting on the divider. Frames are decoded once and cached;
 * swapping states never re-reads disk. If the original mascot assets cannot be
 * loaded, a clear diagnostic is shown instead of unrelated fallback artwork.
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
import {
  findSubjectBox,
  planFrameCrop,
  relativeSubjectBox,
  unionSubjectBoxes,
  type RelativeBox,
} from "./frame-crop.ts";
import { animationFps, frameAt, frameAtTransition } from "./animator.ts";
import { decideRenderer } from "./terminal-detection.ts";
import type { CatActivity } from "./state-mapper.ts";
import type { CatRendererName, CatAnimation, CatState } from "./types.ts";
import { CAT_STATES } from "./types.ts";

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
    /** Optional: retained for compatibility; image mode does not use it. */
    ascii?: unknown;
  };
}

type LoadedImage = { path: string; image: NativeImage };

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
  const frameBoxes = new Map<string, RelativeBox>();
  const pendingGroups = new Map<string, Promise<void>>();

  interface DecodedFrame {
    path: string;
    image: NativeImage;
    box: RelativeBox;
  }

  const decodeFrame = async (path: string): Promise<DecodedFrame | undefined> => {
    try {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      if (disposed) return undefined;
      const image = NativeImage.decode(bytes);
      if (disposed) {
        image.dispose();
        return undefined;
      }
      let box: RelativeBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
      try {
        const raw = image.raw("rgba8");
        const subject = findSubjectBox(raw.data, raw.width, raw.height, raw.stride);
        if (subject) box = relativeSubjectBox(subject, raw.width, raw.height);
      } catch {
        // Keep the full canvas if pixel inspection is unavailable.
      }
      return { path, image, box };
    } catch {
      // Missing/unreadable frame: keep the nearest valid frame on screen.
      return undefined;
    }
  };

  /**
   * Crop the state's shared subject box and pad it to a square with
   * transparency. Using one union box for every frame in the animation avoids
   * the cat pulsing in size between frames while still reclaiming the large
   * baked-in margins in shipped artwork.
   */
  const normalizeFrame = (frame: DecodedFrame, union: RelativeBox): NativeImage => {
    const plan = planFrameCrop(union, frame.image.width, frame.image.height);
    let work = frame.image;
    const { extract, extend, resizeSide } = plan;
    const needsExtract =
      extract.left !== 0 ||
      extract.top !== 0 ||
      extract.width !== work.width ||
      extract.height !== work.height;
    if (needsExtract) {
      const next = work.extract(extract);
      if (next !== work) {
        work.dispose();
        work = next;
      }
    }
    if (extend.top || extend.right || extend.bottom || extend.left) {
      const next = work.extend({ ...extend, background: [0, 0, 0, 0] });
      if (next !== work) {
        work.dispose();
        work = next;
      }
    }
    if (resizeSide > 0) {
      const next = work.resize({ width: resizeSide, height: resizeSide, kernel: "area" });
      if (next !== work) {
        work.dispose();
        work = next;
      }
    }
    return work;
  };

  // Decode and normalize a state's frames together so they share one crop.
  // The group key also deduplicates requests from the animation effect and the
  // prefetcher when both ask for the same state before its frames are ready.
  const ensureGroup = (paths: string[]): Promise<void> => {
    const valid = [...new Set(paths.filter(Boolean))];
    if (valid.length === 0) return Promise.resolve();
    if (valid.every((path) => images.has(path))) return Promise.resolve();
    const key = valid.join("\n");
    const inFlight = pendingGroups.get(key);
    if (inFlight) return inFlight;

    const task = (async () => {
      const loaded = (
        await Promise.all(valid.filter((path) => !images.has(path)).map(decodeFrame))
      ).filter((frame): frame is DecodedFrame => frame !== undefined);
      if (disposed) {
        for (const frame of loaded) frame.image.dispose();
        return;
      }
      const cachedBoxes = valid
        .filter((path) => images.has(path))
        .map((path) => frameBoxes.get(path))
        .filter((box): box is RelativeBox => box !== undefined);
      const union = unionSubjectBoxes([...cachedBoxes, ...loaded.map((frame) => frame.box)]);
      for (const frame of loaded) {
        if (disposed) {
          frame.image.dispose();
          continue;
        }
        const image = normalizeFrame(frame, union);
        images.set(frame.path, { path: frame.path, image });
        frameBoxes.set(frame.path, frame.box);
      }
    })().finally(() => pendingGroups.delete(key));

    pendingGroups.set(key, task);
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
  // most once per visible frame, and `ensureGroup` prevents a slow decode from
  // being started again on every tick.
  createEffect(() => {
    const selected = selection();
    const path = selected.path;
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
    const paths = playback()[selected.state].paths;
    void ensureGroup(paths).then(() => {
      // A late decode must never rewind the loop to a frame the state has
      // already moved past.
      if (!disposed && selection().path === path) setCurrent(images.get(path));
    });
  });

  // Warm the current (or incoming) state's frames together. This makes the
  // first pass through a loop as smooth as later passes without decoding
  // every pack upfront or adding a second timer.
  const prefetchState = createMemo(() => transition()?.toState ?? selection().state);
  createEffect(() => {
    const state = prefetchState();
    if (!imageAvailable()) return;
    const paths = playback()[state].paths;
    if (paths.length === 0) return;
    void ensureGroup(paths);
  });

  onCleanup(() => {
    disposed = true;
    for (const loaded of images.values()) {
      try { loaded.image.dispose(); } catch { /* already released */ }
    }
    images.clear();
    frameBoxes.clear();
    pendingGroups.clear();
  });

  const rows = createMemo((): number => {
    const budget = Math.max(2, Math.floor(props.height ?? 12));
    // Keep one row for the divider and never exceed the caller's height
    // budget. Very short terminals get a smaller cat rather than clipped rows.
    const maxRows = Math.max(1, budget - 1);
    // Terminal cells are roughly twice as tall as they are wide, so a square
    // frame uses half as many rows as columns. This lets the cat use a wide
    // sidebar instead of being clamped to a small fixed height.
    const fullWidthRows = Math.max(1, Math.round(props.width / 2));
    const scaled = Math.max(1, Math.round(fullWidthRows * props.scale));
    return Math.max(1, Math.min(maxRows, scaled));
  });

  const imageWidth = createMemo(() => Math.max(1, Math.min(props.width, Math.round(rows() * 2))));
  const imageX = createMemo(() => Math.max(0, Math.floor((props.width - imageWidth()) / 2)));
  const divider = createMemo(() => "─".repeat(Math.max(0, props.width)));

  // If mascot image assets cannot be loaded/rendered, show a clear diagnostic
  // instead of unrelated fallback artwork.
  const diagnostic = createMemo(() => {
    if (imageAvailable()) return null;
    if (!props.enabled) return null;
    const pack = packData();
    if (pack && !pack.ok) {
      return `Mascot assets unavailable: ${pack.error ?? `invalid pack "${props.pack}"`}`;
    }
    if (!selection().path) {
      return `Mascot assets unavailable: no image frames for state "${selection().state}" in pack "${props.pack}"`;
    }
    return `Mascot assets unavailable: renderer "${props.renderer}" cannot display image assets`;
  });

  return (
    <Show when={props.enabled}>
      <box flexDirection="column" width="100%" minWidth={0} flexShrink={0} overflow="hidden">
        <Show
          when={imageAvailable()}
          fallback={
            <box flexDirection="column" width="100%" minWidth={0} paddingTop={1} paddingBottom={0}>
              <text fg={props.colors.divider} wrapMode="word" width="100%" minWidth={0}>
                {diagnostic() ?? "Mascot assets unavailable"}
              </text>
              <text fg={props.colors.divider} wrapMode="none" width="100%" minWidth={0} truncate={true}>
                {divider()}
              </text>
            </box>
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
