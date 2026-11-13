/**
 * Bounds detection and crop planning for cat frames.
 *
 * Shipped frames are user-owned artwork and may contain large baked-in
 * backgrounds or transparent margins. Rendering the whole canvas at sidebar
 * size wastes most of the available resolution. These helpers find the
 * subject, union it across an animation's frames (so the cat does not pulse
 * between frames), and produce a square crop plan.
 *
 * All functions here are pure; the widget owns decoding and NativeImage work.
 */

export interface PixelBox {
  /** Inclusive. */
  minX: number;
  /** Inclusive. */
  minY: number;
  /** Inclusive. */
  maxX: number;
  /** Inclusive. */
  maxY: number;
}

export interface RelativeBox {
  /** 0..1, inclusive start. */
  minX: number;
  /** 0..1, inclusive start. */
  minY: number;
  /** 0..1, exclusive end. */
  maxX: number;
  /** 0..1, exclusive end. */
  maxY: number;
}

export interface FrameCropPlan {
  extract: { left: number; top: number; width: number; height: number };
  extend: { top: number; right: number; bottom: number; left: number };
  /** Square side before optional downscaling. */
  side: number;
  /** Side to resize to, or 0 when the source is already small enough. */
  resizeSide: number;
}

/** Alpha at or below this is treated as transparent background. */
export const ALPHA_BACKGROUND_THRESHOLD = 8;
/** Per-channel distance from the corner color treated as background. */
export const COLOR_BACKGROUND_THRESHOLD = 8;
/** Extra breathing room around the subject on every side. */
export const FRAME_MARGIN_RATIO = 0.06;
/** Normalized frames above this side are downscaled before rendering. */
export const MAX_NORMALIZED_SIDE = 384;

const FULL_BOX: RelativeBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/**
 * Find the bounding box of non-background pixels.
 *
 * A transparent corner selects alpha-based detection; otherwise the corner
 * color is the background reference. The result is expanded by one pixel so
 * anti-aliased artwork edges are never clipped.
 */
export function findSubjectBox(
  data: Uint8Array,
  width: number,
  height: number,
  stride = width * 4,
): PixelBox | null {
  if (width <= 0 || height <= 0 || data.length < 4) return null;
  if (stride < width * 4) return null;

  const cornerAlpha = data[3] ?? 255;
  const transparentBackground = cornerAlpha <= ALPHA_BACKGROUND_THRESHOLD;
  const cornerR = data[0] ?? 0;
  const cornerG = data[1] ?? 0;
  const cornerB = data[2] ?? 0;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const alpha = data[i + 3] ?? 255;
      let subject: boolean;
      if (transparentBackground) {
        subject = alpha > ALPHA_BACKGROUND_THRESHOLD;
      } else {
        subject =
          alpha > ALPHA_BACKGROUND_THRESHOLD &&
          (Math.abs((data[i] ?? 0) - cornerR) > COLOR_BACKGROUND_THRESHOLD ||
            Math.abs((data[i + 1] ?? 0) - cornerG) > COLOR_BACKGROUND_THRESHOLD ||
            Math.abs((data[i + 2] ?? 0) - cornerB) > COLOR_BACKGROUND_THRESHOLD);
      }
      if (!subject) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  // Ignore specks that are too small to be meaningful artwork.
  if (maxX - minX + 1 < 2 || maxY - minY + 1 < 2) return null;

  return {
    minX: Math.max(0, minX - 1),
    minY: Math.max(0, minY - 1),
    maxX: Math.min(width - 1, maxX + 1),
    maxY: Math.min(height - 1, maxY + 1),
  };
}

export function relativeSubjectBox(box: PixelBox, width: number, height: number): RelativeBox {
  if (width <= 0 || height <= 0) return { ...FULL_BOX };
  return {
    minX: clamp01(box.minX / width),
    minY: clamp01(box.minY / height),
    maxX: clamp01((box.maxX + 1) / width),
    maxY: clamp01((box.maxY + 1) / height),
  };
}

/** Smallest box containing every input. Empty input means "use the canvas". */
export function unionSubjectBoxes(boxes: readonly RelativeBox[]): RelativeBox {
  if (boxes.length === 0) return { ...FULL_BOX };
  const union = { minX: 1, minY: 1, maxX: 0, maxY: 0 };
  for (const box of boxes) {
    const clamped = clampBox(box);
    union.minX = Math.min(union.minX, clamped.minX);
    union.minY = Math.min(union.minY, clamped.minY);
    union.maxX = Math.max(union.maxX, clamped.maxX);
    union.maxY = Math.max(union.maxY, clamped.maxY);
  }
  if (union.maxX <= union.minX || union.maxY <= union.minY) return { ...FULL_BOX };
  return union;
}

/**
 * Turn a relative subject box into a square crop + transparent padding plan.
 *
 * `resizeSide` is 0 when the square is already at or below `maxSide`.
 */
export function planFrameCrop(
  box: RelativeBox,
  width: number,
  height: number,
  options: { margin?: number; maxSide?: number } = {},
): FrameCropPlan {
  const margin = Math.max(0, options.margin ?? FRAME_MARGIN_RATIO);
  const maxSide = Math.max(1, Math.floor(options.maxSide ?? MAX_NORMALIZED_SIDE));
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const clamped = clampBox(box);

  const left = clamp(Math.floor(clamped.minX * safeWidth), 0, safeWidth - 1);
  const top = clamp(Math.floor(clamped.minY * safeHeight), 0, safeHeight - 1);
  const right = clamp(Math.ceil(clamped.maxX * safeWidth), left + 1, safeWidth);
  const bottom = clamp(Math.ceil(clamped.maxY * safeHeight), top + 1, safeHeight);
  const cropWidth = right - left;
  const cropHeight = bottom - top;

  const side = Math.max(1, Math.round(Math.max(cropWidth, cropHeight) * (1 + margin * 2)));
  const padWidth = side - cropWidth;
  const padHeight = side - cropHeight;
  const extendLeft = Math.floor(padWidth / 2);
  const extendRight = padWidth - extendLeft;
  const extendTop = Math.floor(padHeight / 2);
  const extendBottom = padHeight - extendTop;

  return {
    extract: { left, top, width: cropWidth, height: cropHeight },
    extend: { top: extendTop, right: extendRight, bottom: extendBottom, left: extendLeft },
    side,
    resizeSide: side > maxSide ? maxSide : 0,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampBox(box: RelativeBox): RelativeBox {
  const minX = clamp01(box.minX);
  const minY = clamp01(box.minY);
  return {
    minX,
    minY,
    maxX: Math.max(minX, clamp01(box.maxX)),
    maxY: Math.max(minY, clamp01(box.maxY)),
  };
}
