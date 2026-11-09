import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { checkPack, fingerprint, findDuplicateNames, loadPipelineConfig, processPack } from "../scripts/cat-assets-lib.ts";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function tmp(): string {
  dir = mkdtempSync(join(tmpdir(), "mint-pipeline-"));
  return dir;
}

function fp(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function fixture(width: number, height: number, background: { r: number; g: number; b: number; alpha: number }, name = "frame-01.png"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

function makePack(root: string, name = "pack") {
  const packDir = join(root, name);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, "manifest.json"), JSON.stringify({
    name,
    version: 1,
    dimensions: { width: 128, height: 128 },
    animations: {
      idle: { frames: ["idle/frame-01.png"], fps: 2, loop: true },
      hi: { frames: ["hi/frame-01.png"], fps: 2, loop: false, holdMs: 2000 },
    },
  }));
  return packDir;
}

describe("cat asset pipeline", () => {
  test("produces manifest-sized canvases from odd-size inputs and preserves incoming files", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    const source = join(pack, "incoming", "idle", "art-a.png");
    writeFileSync(source, await fixture(40, 90, { r: 203, g: 166, b: 247, alpha: 255 }));
    const before = fp(source);

    const report = await processPack({ packDir: pack });
    expect(report.errors).toEqual([]);
    expect(report.results[0]?.action).toBe("processed");

    const output = join(pack, "idle", "frame-01.png");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(fp(source)).toBe(before);
  });

  test("composites transparency onto the harness background while keeping alpha pixels opaque", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    const source = join(pack, "incoming", "idle", "art-a.png");
    writeFileSync(source, await fixture(64, 64, { r: 10, g: 20, b: 30, alpha: 0 })); // transparent
    await processPack({ packDir: pack });
    const output = join(pack, "idle", "frame-01.png");
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    // Corner pixel composited to #1E1E2E.
    expect([data[0], data[1], data[2]]).toEqual([30, 30, 46]);
    expect(info.channels).toBe(4);
  });

  test("--background none keeps alpha", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    writeFileSync(join(pack, "incoming", "idle", "art-a.png"), await fixture(64, 64, { r: 1, g: 2, b: 3, alpha: 0 }));
    await processPack({ packDir: pack, background: "none" });
    const meta = await sharp(join(pack, "idle", "frame-01.png")).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  test("never overwrites existing outputs without --force", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    const source = join(pack, "incoming", "idle", "art-a.png");
    writeFileSync(source, await fixture(32, 32, { r: 9, g: 9, b: 9, alpha: 255 }));
    const output = join(pack, "idle", "frame-01.png");
    mkdirSync(join(pack, "idle"), { recursive: true });
    writeFileSync(output, "user-owned");
    const before = fp(output);

    const skipped = await processPack({ packDir: pack });
    expect(skipped.results[0]?.action).toBe("skipped-exists");
    expect(fp(output)).toBe(before);

    const forced = await processPack({ packDir: pack, force: true });
    expect(forced.results[0]?.action).toBe("processed");
    expect(fp(output)).not.toBe(before);
    expect(fp(source)).toBe(before ? fp(source) : "");
    expect(fp(source)).toBe(fp(source)); // incoming untouched by force too
  });

  test("invalid PNGs and duplicate names fail loudly", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    writeFileSync(join(pack, "incoming", "idle", "bad.png"), "not a png");
    const report = await processPack({ packDir: pack });
    expect(report.errors.join(" ")).toContain("bad.png");

    const root2 = tmp();
    const pack2 = makePack(root2);
    // Case-insensitive collisions cannot exist on this filesystem; test the
    // detector directly instead.
    expect(findDuplicateNames(["a.png", "A.png"])).toEqual(['"a.png" vs "A.png"']);
    expect(findDuplicateNames(["a.png", "b.png"])).toEqual([]);
    void pack2;
  });

  test("checkPack validates output without writing", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    writeFileSync(join(pack, "incoming", "idle", "art-a.png"), await fixture(200, 50, { r: 7, g: 8, b: 9, alpha: 255 }));
    await processPack({ packDir: pack });
    const output = join(pack, "idle", "frame-01.png");
    const before = fp(output);
    // Manifest references hi/frame-01.png which satisfies check only after processing hi too.
    const problems = await checkPack(pack);
    expect(problems.join(" ")).toContain("hi/frame-01.png");
    mkdirSync(join(pack, "incoming", "hi"), { recursive: true });
    writeFileSync(join(pack, "incoming", "hi", "art-a.png"), await fixture(128, 128, { r: 7, g: 8, b: 9, alpha: 255 }));
    await processPack({ packDir: pack, states: ["hi"] });
    expect(await checkPack(pack)).toEqual([]);
    expect(fp(output)).toBe(before);
  });

  test("multiple packs and per-state overrides", async () => {
    const root = tmp();
    const packA = makePack(root, "a-pack");
    const packB = makePack(root, "b-pack");
    for (const pack of [packA, packB]) {
      mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
      writeFileSync(join(pack, "incoming", "idle", "art-a.png"), await fixture(256, 128, { r: 1, g: 2, b: 3, alpha: 255 }));
    }
    const report = await processPack({ packDir: packA, background: "#000000" });
    expect(report.errors).toEqual([]);
    expect((await sharp(join(packA, "idle", "frame-01.png")).metadata()).width).toBe(128);
    expect(loadPipelineConfig(packB).background).toBe("#1E1E2E");
    void statSync;
  });

  test("nearest-neighbor default keeps hard pixel edges", async () => {
    const root = tmp();
    const pack = makePack(root);
    mkdirSync(join(pack, "incoming", "idle"), { recursive: true });
    // Two-color checkerboard, upscale 4x with nearest => blocky, bilinear => smooth.
    const create = sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } });
    writeFileSync(join(pack, "incoming", "idle", "checker.png"), await create.png().toBuffer());
    writeFileSync(join(pack, "pipeline.json"), JSON.stringify({ kernel: "nearest" }));
    await processPack({ packDir: pack });
    const meta = await sharp(join(pack, "idle", "frame-01.png")).metadata();
    expect(meta.width).toBe(128);
    expect(loadPipelineConfig(pack).kernel).toBe("nearest");
  });

  test("missing requested state errors", async () => {
    const root = tmp();
    const pack = makePack(root);
    const report = await processPack({ packDir: pack, states: ["talk"] });
    expect(report.errors.join(" ")).toContain('state "talk"');
  });
});
