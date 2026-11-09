#!/usr/bin/env bun
/**
 * Generates the sample cat PNG asset pack for MINT (default).
 *
 * No image tooling required: PNGs are encoded directly (RGBA + zlib deflate).
 * Each state ships real frames with a genuine alpha channel, consistent
 * 128x128 dimensions, and shared alignment across all packs. Users can replace
 * any PNG with their own artwork — no TypeScript edits needed.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE } from "../src/cat-line-art.ts";

const OUT = new URL("../src/cat/assets/", import.meta.url).pathname.replace(/^\//, "");
const SIZE = 128;

type RGBA = [number, number, number, number];
type Palette = Record<string, RGBA>;

const PACKS: Record<string, Palette> = {
  default: {
    // Background baked to the Mint harness color (#1e1e2e) so transparent
    // regions blend with the TUI in every terminal (some render alpha as black).
    ".": [30, 30, 46, 255],
    o: [119, 113, 132, 255],
    "#": [203, 166, 247, 255],
    l: [245, 194, 231, 255],
    e: [250, 179, 135, 255],
  },
};

// --- sprite transforms on the 16x16 base grid ---

function grid(rows: string[]): string[][] { return rows.map((r) => r.split("")); }
function rowsToGrid(g: string[][]): string[] { return g.map((r) => r.join("")); }
function set(g: string[][], x: number, y: number, ch: string) { if (g[y] && x >= 0 && x < 16) g[y]![x] = ch; }
function get(g: string[][], x: number, y: number): string { return g[y]?.[x] ?? "."; }

/** Closed-eye blink: eyes become dark bottom lines. */
function blinkVariant(): string[] {
  const g = grid(BASE);
  for (let y = 4; y <= 6; y++) for (const x of [4, 5, 10, 11]) {
    if (get(g, x, y) === "e" || get(g, x, y) === "o") set(g, x, y, y === 5 ? "o" : "#");
  }
  return rowsToGrid(g);
}

/** Happy eyes (curves up) + open smile. */
function happyVariant(): string[] {
  const g = grid(blinkVariant());
  for (const x of [3, 4, 10, 11]) { set(g, x, 4, "#"); set(g, x, 5, "o"); set(g, x, 6, "#"); }
  set(g, 7, 8, "o"); set(g, 8, 8, "o");
  return rowsToGrid(g);
}

/** Wink: left eye happy, right eye open. */
function winkVariant(): string[] {
  const g = grid(BASE);
  for (const x of [3, 4]) { set(g, x, 4, "#"); set(g, x, 5, "o"); set(g, x, 6, "#"); }
  set(g, 7, 8, "o"); set(g, 8, 8, "o");
  return rowsToGrid(g);
}

/** Thinking: head rows shifted right by one, ears a touch lower. */
function thinkVariant(): string[] {
  const g = grid(BASE);
  for (let y = 0; y <= 7; y++) {
    const src = [...BASE[y]!];
    for (let x = 2; x <= 14; x++) g[y]![x] = src[x - 1] ?? ".";
    g[y]![2] = ".";
  }
  for (const x of [3, 4, 10, 11]) { set(g, x, 0, "."); }
  set(g, 3, 1, "o"); set(g, 4, 1, "o"); set(g, 10, 1, "o"); set(g, 11, 1, "o");
  return rowsToGrid(g);
}

/** Reading: pupils dropped low (looking down). */
function readVariant(): string[] {
  const g = grid(BASE);
  for (const [x, y] of [[4, 4], [5, 4], [10, 4], [11, 4]] as const) set(g, x, y, "#");
  for (const [x, y] of [[4, 6], [10, 6]] as const) set(g, x, y, "o");
  return rowsToGrid(g);
}

/** Writing: right eye half-closed, head slightly tilted right. */
function writeVariant(): string[] {
  const g = grid(thinkVariant());
  for (let y = 4; y <= 6; y++) { set(g, 10, y, "#"); set(g, 11, y, "#"); }
  set(g, 10, 5, "o"); set(g, 11, 5, "o");
  return rowsToGrid(g);
}

/** Working: pupils glance sideways (tools in action). */
function toolVariant(): string[] {
  const g = grid(BASE);
  for (const [x, y] of [[4, 4], [10, 5]] as const) set(g, x, y, "e");
  for (const [x, y] of [[5, 4], [11, 5]] as const) set(g, x, y, "o");
  return rowsToGrid(g);
}

/** Failure: ears droop + X eyes. */
function sadVariant(): string[] {
  const g = grid(BASE);
  set(g, 3, 0, "."); set(g, 4, 0, "."); set(g, 10, 0, "."); set(g, 11, 0, ".");
  set(g, 3, 1, "o"); set(g, 4, 1, "o"); set(g, 10, 1, "o"); set(g, 11, 1, "o");
  for (const x of [3, 4, 10, 11]) { set(g, x, 4, "o"); set(g, x, 5, "#"); set(g, x, 6, "o"); }
  set(g, 6, 8, "o"); set(g, 7, 8, "o"); set(g, 8, 8, "o"); set(g, 9, 8, "o");
  return rowsToGrid(g);
}

/** Mouth widths for talk frames (closed, small, mid, wide). */
function talkVariant(mouth: "closed" | "small" | "mid" | "wide"): string[] {
  const g = grid(BASE);
  if (mouth === "closed") return BASE;
  if (mouth === "small") { set(g, 7, 8, "o"); set(g, 8, 8, "o"); }
  if (mouth === "mid") { set(g, 6, 8, "o"); set(g, 7, 8, "o"); set(g, 8, 8, "o"); set(g, 9, 8, "o"); set(g, 7, 9, "o"); set(g, 8, 9, "o"); }
  if (mouth === "wide") {
    for (const x of [6, 7, 8, 9]) { set(g, x, 8, "o"); set(g, x, 9, "o"); if (x === 7 || x === 8) set(g, x, 10, "o"); }
    set(g, 6, 9, "o"); set(g, 9, 9, "o");
  }
  return rowsToGrid(g);
}

const FRAMES: Record<string, string[][]> = {
  idle: [BASE, blinkVariant()],
  think: [BASE, thinkVariant()],
  talk: [talkVariant("closed"), talkVariant("small"), talkVariant("mid"), talkVariant("wide")],
  read: [BASE, readVariant()],
  write: [BASE, writeVariant()],
  tool: [BASE, toolVariant()],
  success: [happyVariant(), winkVariant()],
  failure: [sadVariant(), sadVariant()],
  hi: [happyVariant(), winkVariant()],
};

const ANIMATION_FPS: Record<string, number> = { idle: 2, think: 1.5, talk: 4, read: 3, write: 3, tool: 3, success: 2, failure: 2, hi: 2 };

// --- PNG encoder ---

function crc32(chunk: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < chunk.length; i++) {
    crc ^= chunk[i]!;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkOf(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(rows: string[], palette: Palette): Uint8Array {
  const raw = new Uint8Array((SIZE * 4 + 1) * SIZE);
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0; // filter: none
    const gy = Math.min(15, (y * 16) / SIZE | 0);
    for (let x = 0; x < SIZE; x++) {
      const gx = Math.min(15, (x * 16) / SIZE | 0);
      const rgba = palette[rows[gy]![gx]!] ?? palette["."]!;
      raw[o++] = rgba[0]; raw[o++] = rgba[1]; raw[o++] = rgba[2]; raw[o++] = rgba[3];
    }
  }
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, SIZE); dv.setUint32(4, SIZE);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunkOf("IHDR", ihdr), chunkOf("IDAT", idat), chunkOf("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let p0 = 0;
  for (const part of parts) { png.set(part, p0); p0 += part.length; }
  return png;
}

const manifestFor = (name: string, palette: Palette) => ({
  name,
  version: 1,
  dimensions: { width: SIZE, height: SIZE },
  animations: Object.fromEntries(
    Object.entries(FRAMES).map(([state, frames]) => [
      state,
      {
        frames: frames.map((_, i) => `${state}/frame-${String(i + 1).padStart(2, "0")}.png`),
        fps: ANIMATION_FPS[state] ?? 3,
        loop: !["success", "failure", "hi"].includes(state),
        holdMs: state === "success" ? 2200 : state === "failure" ? 2600 : state === "hi" ? 2000 : 0,
      },
    ]),
  ),
  palette: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, `#${v.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("")}`])),
});

for (const [pack, palette] of Object.entries(PACKS)) {
  const dir = `${OUT}${pack}/`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}manifest.json`, JSON.stringify(manifestFor("MINT Cat (Default)", palette), null, 2) + "\n");
  let count = 0;
  for (const [state, frames] of Object.entries(FRAMES)) {
    mkdirSync(`${dir}${state}/`, { recursive: true });
    frames.forEach((frame, i) => {
      const path = `${dir}${state}/frame-${String(i + 1).padStart(2, "0")}.png`;
      writeFileSync(path, encodePng(frame, palette));
      count++;
    });
  }
  console.log(`${pack}: manifest + ${count} PNGs`);
}
console.log("Done.");
