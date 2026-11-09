/**
 * Minimal pixel-art cat mascot for the MINT terminal.
 *
 * A tiny hand-built pixel sprite is stored as a string grid and rendered with
 * Unicode upper-half blocks (`▀`): foreground color is the upper pixel,
 * background color is the lower pixel. Transparent pixels use the harness
 * background color, so no background panel is painted. No PNGs, spritesheets,
 * canvas, NativeImage, or dependencies.
 */

export interface CatPalette {
  transparent: string;
  outline: string;
  body: string;
  light: string;
  eye: string;
}

export type CatState = "idle" | "thinking" | "working" | "success";

export interface CatCell {
  ch: string;
  fg: string;
  bg: string;
}

export interface RenderCatOptions {
  width: number;
  height?: number;
  state?: CatState;
  phase?: number;
  colors: CatPalette;
}

const SPRITE_W = 16;
const SPRITE_H = 16;

// Legend: o outline, # body, l light, e eye, . transparent.
// Sitting front-facing cat, tail curling along the left side.
export const BASE: string[] = [
  "...oo.....oo....",
  "..o#o#...o#o#o..",
  "..o###o.o###o...",
  "..o##########o..",
  "l.o#ee###ee##o..",
  "oo##eo###oeo#o..",
  "o#o#ee###ee##o..",
  "o#o####oo####o..",
  "o#o##########o..",
  "o#o##########o..",
  "o#o#####o#####o.",
  "o#o#####o#####o.",
  "o#o#####o#####o.",
  "o#o#####o#####o.",
  "o#o##########o..",
  ".oo##########oo.",
];

function getPixel(rows: string[], x: number, y: number): string {
  if (y < 0 || y >= rows.length || x < 0 || x >= SPRITE_W) return ".";
  return rows[y]![x]!;
}

function withBlink(rows: string[]): string[] {
  const out = rows.map((row) => row.split(""));
  for (let y = 4; y <= 6; y++) {
    for (const x of [4, 5, 10, 11]) {
      if (out[y]![x] === "e" || out[y]![x] === "o") {
        if (y === 5) out[y]![x] = "o";
        else out[y]![x] = "#";
      }
    }
  }
  return out.map((row) => row.join(""));
}

function withHappy(rows: string[]): string[] {
  const blink = withBlink(rows).map((row) => row.split(""));
  // Happy closed eyes curve upward; open-mouth smile below the nose.
  for (const x of [3, 4, 10, 11]) {
    blink[4]![x] = "#";
    blink[5]![x] = "o";
    blink[6]![x] = "#";
  }
  blink[8]![6] = "#";
  blink[8]![7] = "o";
  blink[8]![8] = "#";
  blink[8]![9] = "o";
  return blink.map((row) => row.join(""));
}

function withThinking(rows: string[], step: number): string[] {
  const dx = step % 2 === 0 ? 1 : -1;
  const out = rows.map((row) => row.split(""));
  for (let y = 0; y <= 7; y++) {
    const source = rows[y]!.split("");
    for (let x = 0; x < SPRITE_W; x++) {
      if (x >= 2 && x <= 14) {
        out[y]![x] = getPixel(source, x - dx, y);
      }
    }
    if (dx === 1) out[y]![2] = ".";
    else out[y]![14] = ".";
  }
  return out.map((row) => row.join(""));
}

function variantRows(state: CatState, phase: number): string[] {
  const step = Math.floor(Math.max(0, phase) / 500);
  if (state === "success") return withHappy(BASE);
  if (state === "thinking") return withThinking(BASE, step);
  if (state === "idle" || state === "working") {
    const blinkActive = phase > 0 && phase % 4000 >= 120 && phase % 4000 < 380;
    if (blinkActive) return withBlink(BASE);
    return BASE;
  }
  return BASE;
}

function sampleRows(rows: string[], scale: number, walkDx: number, walkDy: number): string[][] {
  const height = Math.ceil(rows.length / scale);
  const width = Math.ceil(SPRITE_W / scale);
  const out: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const sx = Math.min(SPRITE_W - 1, x * scale + walkDx);
      const sy = Math.min(rows.length - 1, y * scale + walkDy);
      row.push(getPixel(rows, sx, sy));
    }
    out.push(row);
  }
  return out;
}

export function catPixelRows(): number {
  return 9; // 8 sprite rows + divider
}

/** Backwards-compatible helper used by the TUI integration. */
export function catLineArtRows(_width: number): number {
  return catPixelRows();
}

export function renderCatPixels(options: RenderCatOptions): { rows: CatCell[][]; dividerRow: number } {
  const width = Math.max(8, Math.floor(options.width));
  const state: CatState = options.state ?? "idle";
  const phase = Math.max(0, options.phase ?? 0);
  const palette = options.colors;
  const rows = variantRows(state, phase);

  // Keep the whole strip (sprite + divider) within the available height.
  let scale = 1;
  while (Math.ceil(SPRITE_H / scale / 2) + 1 > (options.height ?? 99)) scale *= 2;
  if (scale > 4) scale = 4;

  const walkSteps = [0, 1, 2, 1, 0, -1, -2, -1];
  const walkStep = state === "working" && phase > 0 ? walkSteps[Math.floor(phase / 450) % walkSteps.length]! : 0;
  const walkDy = state === "working" && phase > 0 && Math.floor(phase / 450) % 2 === 1 ? 1 : 0;

  const sprite = sampleRows(rows, scale, walkStep, walkDy);
  const pixelRows = sprite.length;
  const spriteRows = Math.ceil(pixelRows / 2);
  const spriteCols = sprite[0]?.length ?? 0;
  const offsetX = Math.max(0, Math.min(width - spriteCols, Math.round(width * 0.32) - Math.floor(spriteCols / 2)));
  const dividerRow = spriteRows;
  const totalRows = spriteRows + 1;
  const limit = options.height === undefined ? totalRows : Math.min(totalRows, Math.max(1, Math.floor(options.height)));

  const colorOf = (pixel: string): string => {
    if (pixel === "o") return palette.outline;
    if (pixel === "#") return palette.body;
    if (pixel === "l") return palette.light;
    if (pixel === "e") return palette.eye;
    return palette.transparent;
  };

  const out: CatCell[][] = [];
  for (let cellRow = 0; cellRow < limit; cellRow++) {
    const cells: CatCell[] = [];
    if (cellRow === dividerRow) {
      for (let x = 0; x < width; x++) cells.push({ ch: "─", fg: palette.outline, bg: palette.transparent });
    } else if (cellRow < spriteRows) {
      for (let x = 0; x < width; x++) {
        const sx = x - offsetX;
        const upper = sx >= 0 && sx < spriteCols ? sprite[cellRow * 2]![sx]! : ".";
        const lower = sx >= 0 && sx < spriteCols ? sprite[cellRow * 2 + 1]?.[sx] ?? "." : ".";
        if (upper === "." && lower === ".") cells.push({ ch: " ", fg: palette.transparent, bg: palette.transparent });
        else cells.push({ ch: "▀", fg: colorOf(upper), bg: colorOf(lower) });
      }
    } else {
      for (let x = 0; x < width; x++) cells.push({ ch: " ", fg: palette.transparent, bg: palette.transparent });
    }
    out.push(cells);
  }
  return { rows: out, dividerRow };
}
