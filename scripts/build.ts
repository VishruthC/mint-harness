#!/usr/bin/env bun
/**
 * Build the packaged MINT entry bundle.
 *
 * Global npm installs place the package under `node_modules`, where
 * `@opentui/solid`'s preload transform refuses to compile TSX (its filter
 * excludes every path containing `/node_modules/`). Compiling here, while the
 * sources live outside `node_modules`, produces a plain ESM bundle that runs
 * correctly from an installed package. Runtime dependencies stay external so
 * the installed package resolves its own copies.
 */
import solidPlugin from "@opentui/solid/bun-plugin";
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");

rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "index.tsx")],
  outdir,
  target: "bun",
  format: "esm",
  naming: "index.js",
  plugins: [solidPlugin],
  external: ["@opentui/core", "@opentui/solid", "solid-js", "zod"],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const output = result.outputs.find((entry) => entry.path.endsWith("index.js"));
console.log(`Built ${output?.path ?? join(outdir, "index.js")}`);
