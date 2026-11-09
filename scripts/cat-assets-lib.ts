/**
 * Cat asset pipeline core.
 *
 * Processes incoming PNG artwork into manifest-conformant frames using sharp.
 * This is a build-time tool: it never participates in Mint's runtime and
 * never modifies incoming artwork.
 *
 * Safety contract:
 * - reads only from `<pack>/incoming/<state>/`
 * - writes only into `<pack>/<state>/`
 * - existing outputs are skipped unless `force` is set
 * - manifests are only read, never rewritten
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { parseManifest } from "../src/cat/manifest.ts";
import type { CatManifest } from "../src/cat/types.ts";

export const HARNESS_BG = "#1E1E2E";

export interface PipelineOverride {
  scale?: number;
  dx?: number;
  dy?: number;
}

export interface PipelineConfig {
  background: string | null;
  fit: "contain" | "cover" | "stretch";
  alignX: "start" | "center" | "end";
  alignY: "start" | "center" | "end";
  kernel: "nearest" | "linear" | "lanczos3";
  states: Record<string, PipelineOverride>;
  frames: Record<string, PipelineOverride>; // key: "<state>/<file>"
}

const PipelineFileSchema = z.object({
  background: z.union([z.string(), z.null()]).optional(),
  fit: z.enum(["contain", "cover", "stretch"]).optional(),
  alignX: z.enum(["start", "center", "end"]).optional(),
  alignY: z.enum(["start", "center", "end"]).optional(),
  kernel: z.enum(["nearest", "linear", "lanczos3"]).optional(),
  states: z.record(z.string(), z.object({ scale: z.number().positive().max(8).optional(), dx: z.number().min(-256).max(256).optional(), dy: z.number().min(-256).max(256).optional() })).optional(),
  frames: z.record(z.string(), z.object({ scale: z.number().positive().max(8).optional(), dx: z.number().min(-256).max(256).optional(), dy: z.number().min(-256).max(256).optional() })).optional(),
});

export function defaultPipelineConfig(): PipelineConfig {
  return { background: HARNESS_BG, fit: "contain", alignX: "center", alignY: "center", kernel: "nearest", states: {}, frames: {} };
}

export function loadPipelineConfig(packDir: string): PipelineConfig {
  const base = defaultPipelineConfig();
  const path = join(packDir, "pipeline.json");
  if (!existsSync(path)) return base;
  const parsed = PipelineFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return {
    background: parsed.background === undefined ? base.background : parsed.background,
    fit: parsed.fit ?? base.fit,
    alignX: parsed.alignX ?? base.alignX,
    alignY: parsed.alignY ?? base.alignY,
    kernel: parsed.kernel ?? base.kernel,
    states: parsed.states ?? {},
    frames: parsed.frames ?? {},
  };
}

export function fingerprint(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

export function parseBackground(value: string | null | undefined): { r: number; g: number; b: number; alpha: number } | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return null;
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) throw new Error(`invalid background color "${value}" (expected #RRGGBB or none)`);
  const n = parseInt(match[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 255 };
}

/** Files that collide case-insensitively (e.g. a.png vs A.png). */
export function findDuplicateNames(files: string[]): string[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const file of files) {
    const key = file.toLowerCase();
    if (seen.has(key)) dupes.push(`"${seen.get(key)}" vs "${file}"`);
    seen.set(key, file);
  }
  return dupes;
}

export interface FrameResult {
  source: string;
  output: string;
  action: "processed" | "skipped-exists" | "error" | "unchanged";
  message?: string;
}

export interface PackReport {
  pack: string;
  results: FrameResult[];
  warnings: string[];
  errors: string[];
}

export interface ProcessOptions {
  packDir: string;
  states?: string[];
  force?: boolean;
  background?: string;
  checkOnly?: boolean;
}

function incomingStates(packDir: string): Record<string, string[]> {
  const root = join(packDir, "incoming");
  const found: Record<string, string[]> = {};
  if (!existsSync(root) || !statSync(root).isDirectory()) return found;
  for (const state of readdirSync(root).sort()) {
    const dir = join(root, state);
    if (!statSync(dir).isDirectory()) continue;
    found[state] = readdirSync(dir).filter((f: string) => f.toLowerCase().endsWith(".png")).sort();
  }
  return found;
}

export async function processPack(options: ProcessOptions): Promise<PackReport> {
  const report: PackReport = { pack: basename(options.packDir), results: [], warnings: [], errors: [] };
  const packDir = options.packDir;

  let manifest: CatManifest;
  try {
    manifest = parseManifest(JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8")));
  } catch (error) {
    report.errors.push(`invalid manifest.json: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }
  let pipeline: PipelineConfig;
  try {
    pipeline = loadPipelineConfig(packDir);
  } catch (error) {
    report.errors.push(`invalid pipeline.json: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }
  const background = options.background !== undefined ? parseBackground(options.background) : parseBackground(pipeline.background);
  const canvasW = manifest.dimensions.width;
  const canvasH = manifest.dimensions.height;

  const states = options.states ?? Object.keys(manifest.animations);
  const incoming = incomingStates(packDir);
  for (const state of Object.keys(incoming)) {
    if (!(state in manifest.animations)) report.warnings.push(`incoming/${state}/ is not in the manifest; skipped`);
  }

  for (const state of states) {
    const files = incoming[state];
    if (!files || files.length === 0) {
      if (options.states) report.errors.push(`no incoming frames for state "${state}" in ${join(packDir, "incoming", state)}`);
      continue;
    }
    // Duplicate (case-insensitive) filenames collide on Windows/macOS.
    for (const dupe of findDuplicateNames(files)) {
      report.errors.push(`duplicate frame name in incoming/${state}/: ${dupe}`);
    }
    if (report.errors.length) return report;

    const outDir = join(packDir, state);
    mkdirSync(outDir, { recursive: true });
    let index = 0;
    for (const file of files) {
      index += 1;
      const source = join(packDir, "incoming", state, file);
      const output = join(outDir, `frame-${String(index).padStart(2, "0")}.png`);
      const relative = basename(output);
      if (options.checkOnly) {
        // --check validates inputs without writing anything.
        report.results.push({ source, output: relative, action: "unchanged", message: "check only" });
        continue;
      }
      if (existsSync(output) && !options.force) {
        report.results.push({ source, output: relative, action: "skipped-exists", message: `exists; pass --force to replace` });
        continue;
      }
      try {
        const override = { ...pipeline.states[state], ...pipeline.frames[`${state}/${file}`] };
        await renderFrame(source, output, { canvasW, canvasH, config: pipeline, background, override });
        report.results.push({ source, output: relative, action: "processed" });
      } catch (error) {
        report.errors.push(`${state}/${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return report;
}

async function renderFrame(
  source: string,
  output: string,
  options: {
    canvasW: number;
    canvasH: number;
    config: PipelineConfig;
    background: { r: number; g: number; b: number; alpha: number } | null;
    override: PipelineOverride;
  },
): Promise<void> {
  const meta = await sharp(source).metadata();
  if (meta.format !== "png") throw new Error(`input is ${meta.format ?? "unknown"}, not PNG`);
  if (!meta.width || !meta.height) throw new Error("could not read image dimensions");
  const { canvasW, canvasH, config, background, override } = options;

  let pipeline = sharp(source);
  const scaleFactor = override.scale ?? 1;
  if (config.fit === "cover") {
    pipeline = pipeline.resize(canvasW, canvasH, { fit: "cover", kernel: config.kernel });
  } else if (config.fit === "stretch") {
    pipeline = pipeline.resize(canvasW, canvasH, { kernel: config.kernel });
  } else {
    const fit = Math.min(canvasW / meta.width, canvasH / meta.height) * scaleFactor;
    const w = Math.max(1, Math.round(meta.width * fit));
    const h = Math.max(1, Math.round(meta.height * fit));
    pipeline = pipeline.resize(w, h, { kernel: config.kernel });
    const info = await pipeline.toBuffer({ resolveWithObject: true });
    const left = clampOffset(config.alignX === "start" ? 0 : config.alignX === "end" ? canvasW - w : Math.round((canvasW - w) / 2), canvasW, w) + (override.dx ?? 0);
    const top = clampOffset(config.alignY === "start" ? 0 : config.alignY === "end" ? canvasH - h : Math.round((canvasH - h) / 2), canvasH, h) + (override.dy ?? 0);
    const canvas = sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: info.data, left: clampOffset(left, canvasW, w), top: clampOffset(top, canvasH, h) }]);
    pipeline = canvas;
  }
  if (background) pipeline = pipeline.flatten({ background });
  await pipeline.png({ compressionLevel: 9 }).toFile(output);
}

function clampOffset(value: number, canvas: number, size: number): number {
  return Math.max(0, Math.min(Math.max(0, canvas - size), Math.round(value)));
}

/** Validate processed frames against the manifest without writing. */
export async function checkPack(packDir: string): Promise<string[]> {
  const problems: string[] = [];
  let manifest: CatManifest;
  try {
    manifest = parseManifest(JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8")));
  } catch (error) {
    return [`invalid manifest.json: ${error instanceof Error ? error.message : String(error)}`];
  }
  for (const [state, animation] of Object.entries(manifest.animations) as Array<[string, import("../src/cat/types.ts").CatAnimation | undefined]>) {
    if (!animation) continue;
    for (const frame of animation.frames) {
      const path = join(packDir, frame);
      if (!existsSync(path)) {
        problems.push(`${frame}: missing file`);
        continue;
      }
      try {
        const meta = await sharp(path).metadata();
        if (meta.format !== "png") problems.push(`${frame}: not a PNG`);
        else if (meta.width !== manifest.dimensions.width || meta.height !== manifest.dimensions.height) {
          problems.push(`${frame}: ${meta.width}x${meta.height}, expected ${manifest.dimensions.width}x${manifest.dimensions.height}`);
        }
      } catch {
        problems.push(`${frame}: unreadable PNG`);
      }
    }
  }
  return problems;
}

