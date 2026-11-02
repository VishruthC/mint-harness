import { createMemo, onCleanup, JSX } from "solid-js";
import { NativeImage } from "@opentui/core";
import { renderCatFrame, CAT_ART_SIZE } from "./cat-art";
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