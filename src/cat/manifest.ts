/**
 * Manifest-driven cat asset loading.
 *
 * Each asset pack lives under `src/cat/assets/<pack>/` and ships a
 * `manifest.json` describing its animation states. Manifests are validated,
 * duplicate states collapse to idle, and decoded image bytes are cached by
 * absolute file path so frames are never re-read from disk.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CatManifest, CatState } from "./types.ts";
import { CAT_STATES } from "./types.ts";

const MODULE_DIR = import.meta.dir;
const DEFAULT_PACK = "default";

const AnimationSchema = z.object({
  frames: z.array(z.string().min(1)).min(1),
  fps: z.number().positive().max(30).default(3),
  loop: z.boolean().default(true),
  holdMs: z.number().nonnegative().max(30_000).optional(),
});

const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive().default(1),
  dimensions: z.object({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  }),
  animations: z.record(z.string(), AnimationSchema).default({}),
});

export function parseManifest(value: unknown): CatManifest {
  return ManifestSchema.parse(value) as CatManifest;
}

/**
 * Candidate asset roots in priority order. Source runs resolve to
 * `src/cat/assets`; a bundle in `dist/` falls back to the shipped source
 * assets, which are always part of the package.
 */
export function assetsRootCandidates(moduleDir = MODULE_DIR): string[] {
  return [
    resolve(moduleDir, "assets"),
    resolve(moduleDir, "..", "src", "cat", "assets"),
  ];
}

/** Pick the first existing candidate, or the first candidate as a fallback. */
export function chooseAssetsRoot(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? "";
}

export function assetsRoot(): string {
  const configured = process.env.MINT_CAT_ASSETS?.trim();
  if (configured) return resolve(configured);
  return chooseAssetsRoot(assetsRootCandidates());
}

export function packDir(pack: string): string {
  return join(assetsRoot(), pack);
}

/** Resolve a frame path inside a pack. Empty string means "not available". */
export function framePath(pack: string, frame: string): string {
  if (!frame) return "";
  const candidate = resolve(join(packDir(pack), frame));
  if (!candidate.startsWith(resolve(packDir(pack)))) return "";
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return "";
  return candidate;
}

export function listPacks(): string[] {
  const root = assetsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "manifest.json")))
    .map((entry) => entry.name)
    .sort();
}

/** Built-in fallback manifest (used when a pack is missing or invalid). */
export function fallbackManifest(): CatManifest {
  return {
    name: "MINT Cat (fallback)",
    version: 1,
    dimensions: { width: 128, height: 128 },
    animations: { idle: { frames: [], fps: 2, loop: true } },
  };
}

export interface LoadedPack {
  name: string;
  dir: string;
  manifest: CatManifest;
  ok: boolean;
  error?: string;
}

export function loadPack(pack: string): LoadedPack {
  const dir = packDir(pack);
  const manifestPath = join(dir, "manifest.json");
  try {
    if (!existsSync(manifestPath)) return { name: pack, dir, manifest: fallbackManifest(), ok: false, error: `missing manifest.json in ${dir}` };
    const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    // Drop animations whose frames are all missing; callers fall back to idle.
    for (const state of CAT_STATES) {
      const animation = manifest.animations[state];
      if (!animation) continue;
      animation.frames = animation.frames.filter((frame) => framePath(pack, frame) !== "");
      if (animation.frames.length === 0) delete manifest.animations[state];
    }
    return { name: manifest.name, dir, manifest, ok: Object.keys(manifest.animations).length > 0 };
  } catch (error) {
    return { name: pack, dir, manifest: fallbackManifest(), ok: false, error: error instanceof Error ? error.message : "invalid manifest" };
  }
}

export interface ImageCache {
  load(path: string): Promise<Uint8Array>;
  has(path: string): boolean;
  clear(): void;
}

export function createImageCache(): ImageCache {
  const cache = new Map<string, Uint8Array>();
  return {
    async load(path: string): Promise<Uint8Array> {
      const hit = cache.get(path);
      if (hit) return hit;
      const data = new Uint8Array(readFileSync(path));
      cache.set(path, data);
      return data;
    },
    has: (path) => cache.has(path),
    clear: () => cache.clear(),
  };
}

export function effectiveAnimation(manifest: CatManifest, state: CatState) {
  return manifest.animations[state] ?? manifest.animations.idle ?? { frames: [], fps: 2, loop: true };
}
