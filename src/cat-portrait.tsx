import { createMemo, onCleanup, createSignal, JSX, onMount } from "solid-js";
import { NativeImage } from "@opentui/core";
import { renderCatFrame, CAT_ART_SIZE, renderRunCatFrame, RUN_CAT_SIZE, RUN_CAT_FRAMES } from "./cat-art";
import type { CatExpression, CatMood } from "./cat-art";

interface CatPortraitProps {
  /** Height in terminal cells (width will be 2× for square image) */
  height?: number;
  expression: CatExpression;
  mood: CatMood;
  frame: number;
  /** Whether animations are enabled (controls frame progression) */
  animated?: boolean;
}

export function CatPortrait(props: CatPortraitProps): JSX.Element {
  const height = props.height ?? 12;
  const width = height * 2; // 2:1 cell aspect ratio → square image

  // Generate RGBA frame when expression/mood/frame changes
  const rgbaFrame = createMemo(() => {
    const frame = props.animated ?? true ? props.frame : 0;
    return renderCatFrame({
      expression: props.expression,
      mood: props.mood,
      frame,
      size: CAT_ART_SIZE,
    });
  });

  // Create NativeImage from frame - use a simple derived memo without signal write
  const nativeImage = createMemo(() => {
    const frame = rgbaFrame();
    return NativeImage.fromRgba(frame, CAT_ART_SIZE, CAT_ART_SIZE);
  });

  // Cleanup on unmount - dispose the current image
  onCleanup(() => {
    nativeImage()?.dispose();
  });

  // Reactive source - inline so it tracks the memo
  return (
    <image
      source={nativeImage() ?? undefined}
      width={width}
      height={height}
      fit="fit"
      protocol="auto"
    />
  );
}

/** Small running cat for status line (1 cell high, ~4 cells wide) */
export function RunCatIndicator(props: { busy: boolean; speed?: "trot" | "run" | "sprint" }): JSX.Element {
  const speed = props.speed ?? "run";
  const intervalMs = speed === "sprint" ? 90 : speed === "run" ? 140 : 220;

  const [frame, setFrame] = createSignal(0);
  const timerId = { current: null as ReturnType<typeof setInterval> | null };

  // Pre-generate all frames as NativeImages
  const nativeFrames = createMemo(() => {
    const frames: NativeImage[] = [];
    for (let f = 0; f < RUN_CAT_FRAMES; f++) {
      const rgba = renderRunCatFrame(f, RUN_CAT_SIZE);
      frames.push(NativeImage.fromRgba(rgba, RUN_CAT_SIZE, RUN_CAT_SIZE));
    }
    return frames;
  });

  // Start/stop animation based on busy state
  onMount(() => {
    if (props.busy) {
      timerId.current = setInterval(() => {
        setFrame((f) => (f + 1) % RUN_CAT_FRAMES);
      }, intervalMs);
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (timerId.current) clearInterval(timerId.current);
    nativeFrames()?.forEach((img) => img.dispose());
  });

  // Stop timer when not busy
  if (!props.busy && timerId.current) {
    clearInterval(timerId.current);
    timerId.current = null;
  }

  // Don't render anything when not busy
  if (!props.busy) {
    return <text> </text>;
  }

  // Width ~4 cells (1 cell = 2× aspect), height = 1 cell
  const width = 4;
  const height = 1;

  return (
    <image
      source={nativeFrames()[frame()]}
      width={width}
      height={height}
      fit="fit"
      protocol="auto"
    />
  );
}