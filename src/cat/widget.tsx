/**
 * MINT cat companion widget.
 *
 * Renders the active asset-pack frame as a real PNG via OpenTUI's `<image>`
 * element (Kitty/Sixel/blocks negotiated by OpenTUI), above a full-width
 * divider, paws resting on the divider. Frames are decoded once and cached;
 * swapping states never re-reads disk. Falls back to the existing pixel
 * renderer when image rendering is disabled or unsupported.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { NativeImage } from "@opentui/core";
import { effectiveAnimation, framePath, loadPack, type LoadedPack } from "./manifest.ts";
import { frameAt } from "./animator.ts";
import { decideRenderer } from "./terminal-detection.ts";
import type { CatRendererName, CatState } from "./types.ts";
import { renderCatPixels, type CatCell, type CatPalette } from "../cat-line-art.ts";

export interface CatCompanionProps {
  width: number;
  height?: number;
  state: CatState;
  /** Animation clock in milliseconds, driven by the existing phase ticker. */
  phase: number;
  enabled: boolean;
  pack: string;
  renderer: CatRendererName;
  animation: boolean;
  scale: number;
  idleFps: number;
  workingFps: number;
  colors: {
    divider: string;
    ascii: CatPalette;
  };
}

type LoadedImage = { path: string; image: NativeImage };

const imageCache = new Map<string, LoadedImage>();

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

export function CatCompanion(props: CatCompanionProps) {
  const renderer = useRenderer();
  const [packData, setPackData] = createSignal<LoadedPack | null>(null);
  const [current, setCurrent] = createSignal<LoadedImage | undefined>(undefined);
  const [enteredAt, setEnteredAt] = createSignal(0);
  const [lastState, setLastState] = createSignal<CatState | null>(null);

  createEffect(() => {
    const pack = props.pack;
    setPackData(loadPack(pack));
  });

  createEffect(() => {
    const state = props.state;
    if (lastState() !== state) {
      setLastState(state);
      setEnteredAt(props.phase);
    }
  });

  const decision = createMemo(() => decideRenderer(props.renderer, renderer.capabilities));

  // Assets missing or invalid -> treat as ASCII regardless of renderer.
  const imageAvailable = createMemo(() => {
    if (!props.enabled) return false;
    if (decision().kind !== "image") return false;
    const pack = packData();
    if (!pack || !pack.ok) return false;
    const animation = effectiveAnimation(pack.manifest, props.state);
    return animation.frames.length > 0;
  });

  const framePathFor = createMemo((): string => {
    const pack = packData();
    if (!pack) return "";
    const animation = effectiveAnimation(pack.manifest, props.state);
    const fps = !props.animation
      ? 0
      : props.state === "idle" && props.idleFps > 0
        ? props.idleFps
        : ["talk", "read", "write", "tool"].includes(props.state) && props.workingFps > 0
          ? props.workingFps
          : animation.fps;
    const selected = frameAt({ ...animation, fps }, enteredAt(), props.phase, props.state === "idle" && props.animation);
    const frame = animation.frames[selected.index] ?? animation.frames[0] ?? "";
    return frame ? framePath(props.pack, frame) : "";
  });

  createEffect(() => {
    const path = framePathFor();
    if (!path || !imageAvailable()) {
      setCurrent(undefined);
      return;
    }
    const cached = imageCache.get(path);
    if (cached) {
      setCurrent(cached);
      return;
    }
    setCurrent(undefined);
    (async () => {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      if (path !== framePathFor()) return;
      const image = NativeImage.decode(bytes);
      const loaded = { path, image };
      imageCache.set(path, loaded);
      setCurrent(loaded);
    })().catch(() => setCurrent(undefined));
  });

  onCleanup(() => {
    for (const loaded of imageCache.values()) {
      try { loaded.image.dispose(); } catch { /* already released */ }
    }
    imageCache.clear();
  });

  const rows = createMemo((): number => {
    const budget = props.height ?? 12;
    return Math.max(5, Math.min(budget - 1, Math.round(14 * props.scale)));
  });

  const imageWidth = () => Math.min(props.width, Math.round(rows() * 2));
  const imageX = () => Math.max(0, Math.min(props.width - imageWidth(), Math.round(props.width * 0.30)));

  // Fallback whenever the image path cannot run (renderer=ascii, missing
  // pack, or no frames), so the cat never breaks the layout.
  const fallback = createMemo(() => {
    if (imageAvailable()) return null;
    const map: Record<CatState, "idle" | "thinking" | "working" | "success"> = {
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
    return renderCatPixels({
      width: props.width,
      height: props.height,
      state: map[props.state],
      phase: props.phase,
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
            {"─".repeat(Math.max(0, props.width))}
          </text>
        </Show>
      </box>
    </Show>
  );
}
