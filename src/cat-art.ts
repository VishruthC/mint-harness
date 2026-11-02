/**
 * Pure RGBA cat portrait renderer — framework-free, testable, deterministic.
 * Draws a 2× anti-aliased chibi cat and downscales for clean edges.
 * No external assets; generates all pixels in memory.
 */

export const CAT_ART_SIZE = 192;
export const CAT_ART_FRAMES = 12;

export type CatExpression =
  | "idle"
  | "happy"
  | "love"
  | "zoomies"
  | "wizard"
  | "chaos";

export type CatMood =
  | "idle"
  | "curious"
  | "thinking"
  | "happy"
  | "error"
  | "zoomies"
  | "sleepy"
  | "love";

export interface CatArtOptions {
  expression: CatExpression;
  mood: CatMood;
  frame: number;
  size?: number;
}

/** Palette — sRGB uint8 values */
const PALETTE = {
  // Fur
  furDark: [60, 48, 78, 255] as const,
  furMid: [132, 108, 168, 255] as const,
  furLight: [203, 166, 247, 255] as const,
  furHighlight: [235, 218, 255, 255] as const,

  // Outline
  outline: [40, 32, 55, 255] as const,

  // Muzzle / chest
  cream: [255, 235, 205, 255] as const,
  creamDark: [220, 195, 160, 255] as const,

  // Pink accents
  pinkLight: [245, 194, 231, 255] as const,
  pinkMid: [240, 160, 210, 255] as const,
  pinkDark: [200, 120, 170, 255] as const,

  // Eyes
  eyeWhite: [255, 255, 255, 255] as const,
  eyeDark: [30, 25, 40, 255] as const,
  eyeHighlight: [255, 255, 255, 255] as const,
  eyeBlue: [90, 160, 230, 255] as const,
  eyeGold: [255, 200, 60, 255] as const,

  // Collar
  mint: [166, 227, 161, 255] as const,
  mintDark: [110, 180, 105, 255] as const,
  gold: [255, 215, 0, 255] as const,
  goldDark: [200, 170, 0, 255] as const,

  // Mood auras
  auraIdle: [132, 108, 168, 30] as const,
  auraHappy: [245, 194, 231, 35] as const,
  auraLove: [245, 194, 231, 45] as const,
  auraZoomies: [250, 179, 135, 40] as const,
  auraThinking: [132, 108, 168, 35] as const,
  auraError: [243, 139, 168, 40] as const,
  auraSleepy: [132, 108, 168, 25] as const,
  auraCurious: [166, 227, 161, 35] as const,

  // Effects
  sparkle: [255, 255, 255, 255] as const,
  heartRed: [243, 139, 168, 255] as const,
  heartPink: [245, 194, 231, 255] as const,
  zColor: [132, 108, 168, 255] as const,
  motionLine: [250, 179, 135, 180] as const,
  starGold: [255, 215, 0, 255] as const,
  alertRed: [243, 139, 168, 255] as const,

  // Ground shadow
  shadow: [30, 24, 40, 60] as const,

  // Wizard hat
  hatPurple: [100, 60, 140, 255] as const,
  hatDark: [70, 40, 100, 255] as const,
  hatStar: [255, 215, 0, 255] as const,

  // Chaos
  chaosSpike: [243, 139, 168, 255] as const,
  chaosEye: [255, 60, 60, 255] as const,
} as const;

type Color = readonly [number, number, number, number];

/** Simple 2D canvas-like buffer with float accumulation for AA */
class AARenderer {
  width: number;
  height: number;
  /** Float32 RGBA for accumulation */
  data: Float32Array;

  constructor(size: number) {
    this.width = size;
    this.height = size;
    this.data = new Float32Array(size * size * 4);
  }

  /** Set pixel with alpha blending (source-over) */
  set(x: number, y: number, color: Color, alpha = 1): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const sa = color[3] / 255 * alpha;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    this.data[i] = (color[0] * sa + this.data[i] * da * (1 - sa)) / oa;
    this.data[i + 1] = (color[1] * sa + this.data[i + 1] * da * (1 - sa)) / oa;
    this.data[i + 2] = (color[2] * sa + this.data[i + 2] * da * (1 - sa)) / oa;
    this.data[i + 3] = Math.round(oa * 255);
  }

  /** Get pixel (for testing) */
  get(x: number, y: number): Color {
    const i = (y * this.width + x) * 4;
    return [
      Math.round(this.data[i]),
      Math.round(this.data[i + 1]),
      Math.round(this.data[i + 2]),
      Math.round(this.data[i + 3]),
    ] as Color;
  }

  /** Convert to Uint8Array RGBA */
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(Math.min(255, Math.max(0, this.data[i])));
    }
    return out;
  }

  /** Downsample 2× → 1× with box filter */
  downsample2x(): Uint8Array {
    const outW = this.width / 2;
    const outH = this.height / 2;
    const out = new Uint8Array(outW * outH * 4);
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = ((y * 2 + dy) * this.width + (x * 2 + dx)) * 4;
            const pa = this.data[i + 3];
            r += this.data[i] * pa;
            g += this.data[i + 1] * pa;
            b += this.data[i + 2] * pa;
            a += pa;
          }
        }
        const oi = (y * outW + x) * 4;
        if (a > 0) {
          out[oi] = Math.round(r / a);
          out[oi + 1] = Math.round(g / a);
          out[oi + 2] = Math.round(b / a);
          out[oi + 3] = Math.round(a / 4);
        }
      }
    }
    return out;
  }
}

/** Distance from point to ellipse */
function ellipseDist(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point to rounded rect */
function roundedRectDist(x: number, y: number, cx: number, cy: number, w: number, h: number, r: number): number {
  const dx = Math.abs(x - cx) - w / 2 + r;
  const dy = Math.abs(y - cy) - h / 2 + r;
  const mx = Math.max(dx, 0);
  const my = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(mx * mx + my * my) - r;
}

/** Smoothstep */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Draw filled ellipse with soft edge */
function drawEllipse(r: AARenderer, cx: number, cy: number, rx: number, ry: number, color: Color, feather = 1.5): void {
  const minX = Math.max(0, Math.floor(cx - rx - feather));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + rx + feather));
  const minY = Math.max(0, Math.floor(cy - ry - feather));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + ry + feather));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = ellipseDist(x, y, cx, cy, rx, ry);
      const a = 1 - smoothstep(1 - feather / Math.max(rx, ry), 1, d);
      if (a > 0.01) r.set(x, y, color, a);
    }
  }
}

/** Draw ellipse outline */
function drawEllipseOutline(r: AARenderer, cx: number, cy: number, rx: number, ry: number, color: Color, thickness = 2): void {
  const minX = Math.max(0, Math.floor(cx - rx - thickness));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + rx + thickness));
  const minY = Math.max(0, Math.floor(cy - ry - thickness));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + ry + thickness));
  const maxR = Math.max(rx, ry);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = ellipseDist(x, y, cx, cy, rx, ry);
      const a = 1 - smoothstep(0, thickness / maxR, Math.abs(d - 1));
      if (a > 0.05) r.set(x, y, color, a);
    }
  }
}

/** Draw rounded rect */
function drawRoundedRect(r: AARenderer, cx: number, cy: number, w: number, h: number, rad: number, color: Color, feather = 1.5): void {
  const minX = Math.max(0, Math.floor(cx - w / 2 - feather));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + w / 2 + feather));
  const minY = Math.max(0, Math.floor(cy - h / 2 - feather));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + h / 2 + feather));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = roundedRectDist(x, y, cx, cy, w, h, rad);
      const a = 1 - smoothstep(-feather, 0, d);
      if (a > 0.01) r.set(x, y, color, a);
    }
  }
}

/** Draw rounded rect outline */
function drawRoundedRectOutline(r: AARenderer, cx: number, cy: number, w: number, h: number, rad: number, color: Color, thickness = 2): void {
  const minX = Math.max(0, Math.floor(cx - w / 2 - thickness));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + w / 2 + thickness));
  const minY = Math.max(0, Math.floor(cy - h / 2 - thickness));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + h / 2 + thickness));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = roundedRectDist(x, y, cx, cy, w, h, rad);
      const a = 1 - smoothstep(0, thickness, Math.abs(d));
      if (a > 0.05) r.set(x, y, color, a);
    }
  }
}

/** Draw triangle (for ears) */
function drawTriangle(r: AARenderer, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: Color, feather = 1.5): void {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3) - feather));
  const maxX = Math.min(r.width - 1, Math.ceil(Math.max(x1, x2, x3) + feather));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3) - feather));
  const maxY = Math.min(r.height - 1, Math.ceil(Math.max(y1, y2, y3) + feather));
  // Barycentric
  const denom = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denom;
      const b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denom;
      const c = 1 - a - b;
      const d = Math.min(a, b, c);
      const a2 = 1 - smoothstep(-feather / 20, 0, -d);
      if (a2 > 0.01) r.set(x, y, color, a2);
    }
  }
}

/** Draw triangle outline - strokes three edges */
function drawTriangleOutline(r: AARenderer, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: Color, thickness = 2): void {
  drawLine(r, x1, y1, x2, y2, color, thickness);
  drawLine(r, x2, y2, x3, y3, color, thickness);
  drawLine(r, x3, y3, x1, y1, color, thickness);
}

/** Draw bezier curve (quadratic) */
function drawCurve(r: AARenderer, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, color: Color, thickness = 2): void {
  const minX = Math.max(0, Math.floor(Math.min(x1, cx, x2) - thickness));
  const maxX = Math.min(r.width - 1, Math.ceil(Math.max(x1, cx, x2) + thickness));
  const minY = Math.max(0, Math.floor(Math.min(y1, cy, y2) - thickness));
  const maxY = Math.min(r.height - 1, Math.ceil(Math.max(y1, cy, y2) + thickness));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Distance to quadratic bezier (approximate via sampling)
      let bestD = Infinity;
      for (let t = 0; t <= 1; t += 0.02) {
        const mt = 1 - t;
        const bx = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
        const by = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
        const dx = x - bx;
        const dy = y - by;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) bestD = d;
      }
      const a = 1 - smoothstep(0, thickness, bestD);
      if (a > 0.05) r.set(x, y, color, a);
    }
  }
}

/** Draw line with round caps */
function drawLine(r: AARenderer, x1: number, y1: number, x2: number, y2: number, color: Color, thickness = 2): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular vector (-uy, ux) for CCW 90°
  const px = -uy;
  const py = ux;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - thickness));
  const maxX = Math.min(r.width - 1, Math.ceil(Math.max(x1, x2) + thickness));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - thickness));
  const maxY = Math.min(r.height - 1, Math.ceil(Math.max(y1, y2) + thickness));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const vx = x - x1;
      const vy = y - y1;
      const proj = vx * ux + vy * uy;
      let d: number;
      if (proj < 0) d = Math.sqrt(vx * vx + vy * vy);
      else if (proj > len) d = Math.sqrt((x - x2) ** 2 + (y - y2) ** 2);
      else d = Math.abs(vx * (-uy) + vy * ux); // Correct perpendicular distance: |vy*ux - vx*uy|
      const a = 1 - smoothstep(0, thickness, d);
      if (a > 0.05) r.set(x, y, color, a);
    }
  }
}

/** Draw arc */
function drawArc(r: AARenderer, cx: number, cy: number, radius: number, start: number, end: number, color: Color, thickness = 2): void {
  const minX = Math.max(0, Math.floor(cx - radius - thickness));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + radius + thickness));
  const minY = Math.max(0, Math.floor(cy - radius - thickness));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + radius + thickness));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.abs(Math.sqrt(dx * dx + dy * dy) - radius);
      const angle = Math.atan2(dy, dx);
      const inRange = start < end ? angle >= start && angle <= end : angle >= start || angle <= end;
      if (inRange) {
        const a = 1 - smoothstep(0, thickness, d);
        if (a > 0.05) r.set(x, y, color, a);
      }
    }
  }
}

/** Draw heart shape - upright (cy - y) */
function drawHeart(r: AARenderer, cx: number, cy: number, size: number, color: Color, feather = 1.5): void {
  const minX = Math.max(0, Math.floor(cx - size - feather));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + size + feather));
  const minY = Math.max(0, Math.floor(cy - size - feather));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + size + feather));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x - cx) / size;
      const dy = (cy - y) / size; // inverted Y so heart points up
      // Heart implicit equation: (x² + y² - 1)³ - x²y³ ≤ 0
      const x2 = dx * dx;
      const y2 = dy * dy;
      const val = Math.pow(x2 + y2 - 1, 3) - x2 * dy * y2;
      const a = 1 - smoothstep(-feather / size * 2, 0, val);
      if (a > 0.01) r.set(x, y, color, a);
    }
  }
}

/** Draw star (5-point) */
function drawStar(r: AARenderer, cx: number, cy: number, outerR: number, innerR: number, color: Color, rotation = 0, feather = 1): void {
  const minX = Math.max(0, Math.floor(cx - outerR - feather));
  const maxX = Math.min(r.width - 1, Math.ceil(cx + outerR + feather));
  const minY = Math.max(0, Math.floor(cy - outerR - feather));
  const maxY = Math.min(r.height - 1, Math.ceil(cy + outerR + feather));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx) - rotation;
      const r_norm = Math.sqrt(dx * dx + dy * dy);
      // Star distance
      const points = 5;
      const slice = Math.PI * 2 / points;
      const sliceAngle = ((angle % slice) + slice) % slice;
      const targetR = sliceAngle < slice / 2 ? outerR : innerR;
      const d = Math.abs(r_norm - targetR);
      const a = 1 - smoothstep(0, feather, d);
      if (a > 0.05) r.set(x, y, color, a);
    }
  }
}

/** Get aura color for mood */
function getAuraColor(mood: CatMood): Color {
  switch (mood) {
    case "happy": return PALETTE.auraHappy;
    case "love": return PALETTE.auraLove;
    case "zoomies": return PALETTE.auraZoomies;
    case "thinking": return PALETTE.auraThinking;
    case "error": return PALETTE.auraError;
    case "sleepy": return PALETTE.auraSleepy;
    case "curious": return PALETTE.auraCurious;
    default: return PALETTE.auraIdle;
  }
}

/** Main render function */
export function renderCatFrame(opts: CatArtOptions): Uint8Array {
  const size = opts.size ?? CAT_ART_SIZE;
  const frame = opts.frame % CAT_ART_FRAMES;
  const animated = opts.frame >= 0; // negative = static frame 0

  // Render at 2× for AA
  const r = new AARenderer(size * 2);
  const cx = size;
  const cy = size;
  const s = 1; // design coordinates are at 1×

  // --- Animation values ---
  const blinkCycle = animated ? frame % 12 : 0;
  const isBlinking = blinkCycle === 9 || blinkCycle === 10; // frames 9,10 = blink
  const tailPhase = animated ? (frame / 12) * Math.PI * 2 : 0;
  const breathPhase = animated ? (frame / 12) * Math.PI * 2 : 0;
  const earTwitch = animated && frame % 6 === 0 ? 2 : 0;
  const heartFloat = animated ? Math.sin(frame / 6 * Math.PI * 2) * 3 : 0;
  const sparklePhase = animated ? (frame / 12) * Math.PI * 2 : 0;
  const zFloat = animated ? (frame % 8) / 8 * 10 : 0;

  const breathY = Math.sin(breathPhase) * 1.5;
  const tailSway = Math.sin(tailPhase) * 8;
  const tailSway2 = Math.sin(tailPhase + 1) * 4;

  // --- Mood aura (behind everything) ---
  const auraColor = getAuraColor(opts.mood);
  drawEllipse(r, cx, cy + 40, 110, 90, auraColor, 20);

  // --- Ground shadow ---
  drawEllipse(r, cx, cy + 140, 70, 12, PALETTE.shadow, 8);

  // --- Body ---
  const bodyCy = cy + 30 + breathY;
  // Main body - fixed radius (was 70 * s / 384 * 384 = 70 * size)
  drawEllipse(r, cx, bodyCy, 70, 55, PALETTE.furMid, 2);
  drawEllipseOutline(r, cx, bodyCy, 70, 55, PALETTE.outline, 3);

  // Chest fluff
  drawEllipse(r, cx, bodyCy + 45, 45, 20, PALETTE.cream, 2);
  drawEllipseOutline(r, cx, bodyCy + 45, 45, 20, PALETTE.creamDark, 2);

  // Front paws
  drawEllipse(r, cx - 35, bodyCy + 65, 18, 12, PALETTE.furMid, 1.5);
  drawEllipseOutline(r, cx - 35, bodyCy + 65, 18, 12, PALETTE.outline, 2);
  drawEllipse(r, cx + 35, bodyCy + 65, 18, 12, PALETTE.furMid, 1.5);
  drawEllipseOutline(r, cx + 35, bodyCy + 65, 18, 12, PALETTE.outline, 2);

  // --- Tail (curved, animated) ---
  const tailBaseX = cx + 60;
  const tailBaseY = bodyCy + 10;
  const tailTipX = tailBaseX + 40 + tailSway;
  const tailTipY = tailBaseY + 50 + tailSway2;
  const tailCtrlX = tailBaseX + 30 + tailSway * 0.5;
  const tailCtrlY = tailBaseY + 25;
  // Tail as thick curve with smooth outline (two-pass instead of beaded)
  for (let t = 0; t <= 1; t += 0.015) {
    const mt = 1 - t;
    const x = mt * mt * tailBaseX + 2 * mt * t * tailCtrlX + t * t * tailTipX;
    const y = mt * mt * tailBaseY + 2 * mt * t * tailCtrlY + t * t * tailTipY;
    const thickness = 16 * (1 - t * 0.5);
    drawEllipse(r, x, y, thickness, thickness, PALETTE.furMid, 1);
  }
  // Single smooth outline stroke along curve
  for (let t = 0; t <= 1; t += 0.015) {
    const mt = 1 - t;
    const x = mt * mt * tailBaseX + 2 * mt * t * tailCtrlX + t * t * tailTipX;
    const y = mt * mt * tailBaseY + 2 * mt * t * tailCtrlY + t * t * tailTipY;
    const thickness = 16 * (1 - t * 0.5);
    drawEllipseOutline(r, x, y, thickness, thickness, PALETTE.outline, 2);
  }

  // --- Head ---
  const headCy = cy - 45 + breathY * 0.5;
  const headScale = 1 + Math.sin(breathPhase) * 0.01;
  // Head base
  drawEllipse(r, cx, headCy, 75 * headScale, 68 * headScale, PALETTE.furMid, 2);
  drawEllipseOutline(r, cx, headCy, 75 * headScale, 68 * headScale, PALETTE.outline, 3);

  // Muzzle - moved down from +15 to +25, smaller
  drawEllipse(r, cx, headCy + 25, 30, 16, PALETTE.cream, 1.5);
  drawEllipseOutline(r, cx, headCy + 25, 30, 16, PALETTE.creamDark, 1.5);

  // Nose
  drawEllipse(r, cx, headCy + 28, 5, 3.5, PALETTE.pinkMid, 1);
  // Nose highlight
  drawEllipse(r, cx - 1.5, headCy + 26.5, 1.5, 1, PALETTE.pinkLight, 0.5);

  // Whiskers
  for (let i = 0; i < 3; i++) {
    const y = headCy + 22 + i * 4;
    drawLine(r, cx - 35, y, cx - 55, y - 3, PALETTE.furDark, 1.5);
    drawLine(r, cx + 35, y, cx + 55, y - 3, PALETTE.furDark, 1.5);
  }

  // --- Ears ---
  const earY = headCy - 55;
  const earX = 42;
  // Left ear
  drawTriangle(
    r,
    cx - earX, earY + 10,
    cx - earX - 25 - earTwitch, earY - 45,
    cx - earX + 15, earY + 5,
    PALETTE.furMid, 2
  );
  drawTriangleOutline(
    r,
    cx - earX, earY + 10,
    cx - earX - 25 - earTwitch, earY - 45,
    cx - earX + 15, earY + 5,
    PALETTE.outline, 3
  );
  // Inner ear
  drawTriangle(
    r,
    cx - earX + 5, earY + 2,
    cx - earX - 15 - earTwitch * 0.6, earY - 30,
    cx - earX + 8, earY - 2,
    PALETTE.pinkLight, 1.5
  );

  // Right ear
  drawTriangle(
    r,
    cx + earX, earY + 10,
    cx + earX + 15, earY + 5,
    cx + earX + 25 + earTwitch, earY - 45,
    PALETTE.furMid, 2
  );
  drawTriangleOutline(
    r,
    cx + earX, earY + 10,
    cx + earX + 15, earY + 5,
    cx + earX + 25 + earTwitch, earY - 45,
    PALETTE.outline, 3
  );
  // Inner ear
  drawTriangle(
    r,
    cx + earX - 5, earY + 2,
    cx + earX - 8, earY - 2,
    cx + earX + 15 + earTwitch * 0.6, earY - 30,
    PALETTE.pinkLight, 1.5
  );

  // --- Eyes ---
  const eyeY = headCy - 5;
  const eyeX = 28;
  const eyeW = isBlinking ? 2 : 18;
  const eyeH = isBlinking ? 2 : 16;

  // Eye whites / base
  const eyeColor = opts.expression === "wizard" ? PALETTE.eyeGold : PALETTE.eyeBlue;
  const pupilColor = opts.expression === "chaos" ? PALETTE.chaosEye : PALETTE.eyeDark;

  // Left eye
  if (isBlinking) {
    // Closed eye: thin horizontal ellipse with outline color
    drawEllipse(r, cx - eyeX, eyeY, eyeW, 3, PALETTE.outline, 1);
  } else {
    drawEllipse(r, cx - eyeX, eyeY, eyeW, eyeH, PALETTE.eyeWhite, 1);
    drawEllipseOutline(r, cx - eyeX, eyeY, eyeW, eyeH, PALETTE.outline, 2);
    // Iris
    drawEllipse(r, cx - eyeX, eyeY, 8, 8, eyeColor, 1);
    // Pupil
    if (opts.mood === "love") {
      drawHeart(r, cx - eyeX, eyeY, 5, PALETTE.heartRed, 1);
    } else if (opts.mood === "sleepy") {
      drawLine(r, cx - eyeX - 6, eyeY, cx - eyeX + 6, eyeY, PALETTE.eyeDark, 2);
    } else if (opts.mood === "error") {
      drawLine(r, cx - eyeX - 5, eyeY - 5, cx - eyeX + 5, eyeY + 5, PALETTE.alertRed, 3);
      drawLine(r, cx - eyeX + 5, eyeY - 5, cx - eyeX - 5, eyeY + 5, PALETTE.alertRed, 3);
    } else {
      drawEllipse(r, cx - eyeX, eyeY, 4, 6, pupilColor, 1);
      // Highlight
      drawEllipse(r, cx - eyeX - 2.5, eyeY - 2.5, 2.5, 2.5, PALETTE.eyeHighlight, 1);
    }
  }

  // Right eye
  if (isBlinking) {
    // Closed eye: thin horizontal ellipse with outline color
    drawEllipse(r, cx + eyeX, eyeY, eyeW, 3, PALETTE.outline, 1);
  } else {
    drawEllipse(r, cx + eyeX, eyeY, eyeW, eyeH, PALETTE.eyeWhite, 1);
    drawEllipseOutline(r, cx + eyeX, eyeY, eyeW, eyeH, PALETTE.outline, 2);
    drawEllipse(r, cx + eyeX, eyeY, 8, 8, eyeColor, 1);
    if (opts.mood === "love") {
      drawHeart(r, cx + eyeX, eyeY, 5, PALETTE.heartRed, 1);
    } else if (opts.mood === "sleepy") {
      drawLine(r, cx + eyeX - 6, eyeY, cx + eyeX + 6, eyeY, PALETTE.eyeDark, 2);
    } else if (opts.mood === "error") {
      drawLine(r, cx + eyeX - 5, eyeY - 5, cx + eyeX + 5, eyeY + 5, PALETTE.alertRed, 3);
      drawLine(r, cx + eyeX + 5, eyeY - 5, cx + eyeX - 5, eyeY + 5, PALETTE.alertRed, 3);
    } else {
      drawEllipse(r, cx + eyeX, eyeY, 4, 6, pupilColor, 1);
      drawEllipse(r, cx + eyeX - 2.5, eyeY - 2.5, 2.5, 2.5, PALETTE.eyeHighlight, 1);
    }
  }

  // --- Eyebrows / expression accents ---
  if (opts.expression === "happy" || opts.mood === "happy") {
    drawCurve(r, cx - eyeX - 12, eyeY - 18, cx - eyeX, eyeY - 22, cx - eyeX + 12, eyeY - 18, PALETTE.furDark, 2);
    drawCurve(r, cx + eyeX - 12, eyeY - 18, cx + eyeX, eyeY - 22, cx + eyeX + 12, eyeY - 18, PALETTE.furDark, 2);
  } else if (opts.mood === "curious") {
    drawCurve(r, cx - eyeX - 12, eyeY - 16, cx - eyeX, eyeY - 20, cx - eyeX + 12, eyeY - 16, PALETTE.furDark, 2);
    drawCurve(r, cx + eyeX - 12, eyeY - 18, cx + eyeX, eyeY - 17, cx + eyeX + 12, eyeY - 18, PALETTE.furDark, 2);
  } else if (opts.expression === "wizard") {
    // Raised brow on one side
    drawCurve(r, cx - eyeX - 12, eyeY - 18, cx - eyeX, eyeY - 24, cx - eyeX + 12, eyeY - 18, PALETTE.furDark, 2);
    drawCurve(r, cx + eyeX - 12, eyeY - 16, cx + eyeX, eyeY - 14, cx + eyeX + 12, eyeY - 16, PALETTE.furDark, 2);
  } else if (opts.expression === "chaos") {
    drawLine(r, cx - eyeX - 10, eyeY - 16, cx - eyeX + 10, eyeY - 22, PALETTE.chaosSpike, 2.5);
    drawLine(r, cx - eyeX + 10, eyeY - 16, cx - eyeX - 10, eyeY - 22, PALETTE.chaosSpike, 2.5);
    drawLine(r, cx + eyeX - 10, eyeY - 22, cx + eyeX + 10, eyeY - 16, PALETTE.chaosSpike, 2.5);
    drawLine(r, cx + eyeX + 10, eyeY - 22, cx + eyeX - 10, eyeY - 16, PALETTE.chaosSpike, 2.5);
  } else if (opts.expression === "zoomies" || opts.mood === "zoomies") {
    drawLine(r, cx - eyeX - 10, eyeY - 20, cx - eyeX + 10, eyeY - 16, PALETTE.furDark, 2);
    drawLine(r, cx + eyeX - 10, eyeY - 20, cx + eyeX + 10, eyeY - 16, PALETTE.furDark, 2);
  } else if (opts.mood === "thinking") {
    drawCurve(r, cx - eyeX - 12, eyeY - 16, cx - eyeX, eyeY - 18, cx - eyeX + 12, eyeY - 16, PALETTE.furDark, 2);
    drawCurve(r, cx + eyeX - 12, eyeY - 19, cx + eyeX, eyeY - 22, cx + eyeX + 12, eyeY - 19, PALETTE.furDark, 2);
    // Thought dots
    for (let i = 0; i < 3; i++) {
      const dotX = cx + eyeX + 20 + i * 8;
      const dotY = eyeY - 28 - i * 3;
      drawEllipse(r, dotX, dotY, 3 - i * 0.5, 3 - i * 0.5, PALETTE.furDark, 1);
    }
  }

  // --- Mouth ---
  const mouthY = headCy + 38;
  if (opts.mood === "happy" || opts.expression === "happy") {
    drawCurve(r, cx - 10, mouthY, cx, mouthY + 6, cx + 10, mouthY, PALETTE.furDark, 2.5);
  } else if (opts.mood === "love") {
    drawCurve(r, cx - 8, mouthY, cx, mouthY + 4, cx + 8, mouthY, PALETTE.furDark, 2);
  } else if (opts.mood === "error") {
    drawLine(r, cx - 8, mouthY, cx + 8, mouthY + 3, PALETTE.alertRed, 2.5);
    drawLine(r, cx - 8, mouthY + 3, cx + 8, mouthY, PALETTE.alertRed, 2.5);
  } else if (opts.mood === "sleepy") {
    drawCurve(r, cx - 6, mouthY + 1, cx, mouthY + 3, cx + 6, mouthY + 1, PALETTE.furDark, 1.5);
  } else {
    // Neutral w mouth
    drawCurve(r, cx - 8, mouthY, cx, mouthY + 3, cx + 8, mouthY, PALETTE.furDark, 1.5);
  }

  // --- Blush - moved down from +10 to +20 ---
  if (opts.mood === "love" || opts.mood === "happy" || opts.expression === "love" || opts.expression === "happy") {
    drawEllipse(r, cx - 45, headCy + 20, 10, 6, PALETTE.pinkLight, 3);
    drawEllipse(r, cx + 45, headCy + 20, 10, 6, PALETTE.pinkLight, 3);
  }

  // --- Collar ---
  drawRoundedRect(r, cx, headCy + 58, 80, 14, 7, PALETTE.mint, 1);
  drawRoundedRectOutline(r, cx, headCy + 58, 80, 14, 7, PALETTE.mintDark, 2);
  // Heart tag
  drawHeart(r, cx, headCy + 58, 6, PALETTE.gold, 1);
  drawHeart(r, cx, headCy + 58, 4.5, PALETTE.goldDark, 1);

  // --- Expression-specific additions ---
  if (opts.expression === "wizard") {
    // Wizard hat
    const hatBaseY = headCy - 70;
    // Brim
    drawEllipse(r, cx, hatBaseY + 5, 60, 8, PALETTE.hatPurple, 1.5);
    drawEllipseOutline(r, cx, hatBaseY + 5, 60, 8, PALETTE.hatDark, 2);
    // Cone
    drawTriangle(
      r,
      cx - 40, hatBaseY + 5,
      cx, hatBaseY - 55,
      cx + 40, hatBaseY + 5,
      PALETTE.hatPurple, 1.5
    );
    drawTriangleOutline(
      r,
      cx - 40, hatBaseY + 5,
      cx, hatBaseY - 55,
      cx + 40, hatBaseY + 5,
      PALETTE.hatDark, 2
    );
    // Hat band
    drawLine(r, cx - 35, hatBaseY - 5, cx + 35, hatBaseY - 5, PALETTE.gold, 3);
    // Star on tip
    drawStar(r, cx, hatBaseY - 55, 10, 4, PALETTE.hatStar, -Math.PI / 2, 1);
    // Sparkles around hat
    if (animated) {
      const sparks = [
        [cx - 50, hatBaseY - 20],
        [cx + 50, hatBaseY - 25],
        [cx - 30, hatBaseY - 45],
        [cx + 45, hatBaseY - 40],
      ];
      for (const [sx, sy] of sparks) {
        const phase = sparklePhase + (sx + sy) * 0.1;
        const alpha = 0.5 + Math.sin(phase) * 0.5;
        drawStar(r, sx, sy, 4 * alpha, 1.5, PALETTE.sparkle, sparklePhase * 2, 1);
      }
    }
  }

  if (opts.expression === "chaos") {
    // Jagged fur spikes
    const spikes = [
      [cx - 70, headCy - 30],
      [cx + 70, headCy - 35],
      [cx - 55, headCy - 55],
      [cx + 60, headCy - 50],
      [cx - 80, bodyCy - 10],
      [cx + 85, bodyCy - 15],
    ];
    for (const [sx, sy] of spikes) {
      drawTriangle(
        r,
        sx - 8, sy + 5,
        sx, sy - 15,
        sx + 8, sy + 5,
        PALETTE.chaosSpike, 1.5
      );
      drawTriangleOutline(
        r,
        sx - 8, sy + 5,
        sx, sy - 15,
        sx + 8, sy + 5,
        PALETTE.outline, 2
      );
    }
    // Glitchy eye effect occasionally
    if (animated && frame % 4 === 0) {
      drawLine(r, cx - eyeX - 12, eyeY - 10, cx - eyeX + 12, eyeY + 10, PALETTE.chaosEye, 1.5);
      drawLine(r, cx + eyeX - 12, eyeY - 10, cx + eyeX + 12, eyeY + 10, PALETTE.chaosEye, 1.5);
    }
  }

  if (opts.expression === "zoomies" || opts.mood === "zoomies") {
    // Motion lines
    if (animated) {
      for (let i = 0; i < 5; i++) {
        const mx = cx - 90 - (frame * 3 + i * 15) % 60;
        const my = bodyCy + 10 + i * 12;
        drawLine(r, mx, my, mx + 20, my - 3, PALETTE.motionLine, 2);
      }
    }
  }

  // --- Floating hearts (love) ---
  if (opts.expression === "love" || opts.mood === "love") {
    if (animated) {
      for (let i = 0; i < 4; i++) {
        const hx = cx + (i % 2 === 0 ? -55 : 55) + (i < 2 ? -10 : 10);
        const hy = headCy - 30 - i * 12 + heartFloat * (i % 2 === 0 ? 1 : -1);
        const size = 6 - i;
        const alpha = 0.7 - i * 0.1;
        drawHeart(r, hx, hy, size, PALETTE.heartRed, 1);
        drawHeart(r, hx, hy, size * 0.7, PALETTE.heartPink, 0.8);
      }
    }
  }

  // --- Sparkles (happy/wizard) ---
  if ((opts.expression === "happy" || opts.mood === "happy" || opts.expression === "wizard") && animated) {
    const sparkles = [
      [cx - 50, headCy - 40],
      [cx + 55, headCy - 35],
      [cx - 60, headCy - 10],
      [cx + 65, headCy - 15],
      [cx - 40, bodyCy - 20],
      [cx + 45, bodyCy - 25],
    ];
    for (let i = 0; i < sparkles.length; i++) {
      const [sx, sy] = sparkles[i];
      const phase = sparklePhase + i * 1.2;
      const alpha = 0.4 + Math.sin(phase) * 0.6;
      if (alpha > 0.2) {
        drawStar(r, sx, sy, 3 * alpha, 1, PALETTE.sparkle, phase, 1);
      }
    }
  }

  // --- Z's (sleepy) ---
  if (opts.mood === "sleepy") {
    if (animated) {
      for (let i = 0; i < 3; i++) {
        const zx = cx + 55 + i * 8;
        const zy = headCy - 40 - i * 10 - zFloat;
        const alpha = 1 - i * 0.2;
        // Draw Z shape
        drawLine(r, zx - 5, zy, zx + 5, zy, PALETTE.zColor, 2);
        drawLine(r, zx + 5, zy, zx - 5, zy + 10, PALETTE.zColor, 2);
        drawLine(r, zx - 5, zy + 10, zx + 5, zy + 10, PALETTE.zColor, 2);
      }
    }
  }

  // --- Curious head tilt indicator ---
  if (opts.mood === "curious") {
    // Small question mark above head
    const qx = cx + 50;
    const qy = headCy - 70;
    drawArc(r, qx, qy - 5, 8, -Math.PI / 2, Math.PI / 2, PALETTE.furDark, 2.5);
    drawLine(r, qx, qy + 3, qx, qy + 13, PALETTE.furDark, 2.5);
    drawEllipse(r, qx, qy + 16, 2.5, 2.5, PALETTE.furDark, 1);
  }

  // Downsample and return
  return r.downsample2x();
}

/** Generate all frames for an expression/mood combo (for testing) */
export function renderAllFrames(expression: CatExpression, mood: CatMood, size = CAT_ART_SIZE): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let f = 0; f < CAT_ART_FRAMES; f++) {
    frames.push(renderCatFrame({ expression, mood, frame: f, size }));
  }
  return frames;
}

/**
 * Get distinct pixel count between two frames */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      diff++;
    }
  }
  return diff;
}