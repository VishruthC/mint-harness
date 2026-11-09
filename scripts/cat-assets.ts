#!/usr/bin/env bun
/**
 * MINT cat asset pipeline CLI.
 *
 *   bun run cat:assets                         process all packs/states
 *   bun run cat:assets -- --pack default       one pack
 *   bun run cat:assets -- --pack default --state idle
 *   bun run cat:assets -- --check              validate without writing
 *   bun run cat:assets -- --force              replace existing outputs
 *   bun run cat:assets -- --background none    keep transparency
 *
 * Incoming artwork is never modified. Existing processed frames are skipped
 * (with a report) unless --force is given. Manifests are never rewritten.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkPack, processPack, type PackReport } from "./cat-assets-lib.ts";

const ASSETS_ROOT = resolve(import.meta.dir, "../src/cat/assets");

interface Args {
  pack?: string;
  state?: string;
  check: boolean;
  force: boolean;
  background?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { check: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s).slice(0, 2) : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === "--pack") args.pack = value();
    else if (flag === "--state") args.state = value();
    else if (flag === "--background") args.background = value();
    else if (flag === "--check") args.check = true;
    else if (flag === "--force") args.force = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag.startsWith("--")) throw new Error(`unknown option ${flag}`);
  }
  return args;
}

function listPacks(): string[] {
  if (!existsSync(ASSETS_ROOT)) return [];
  return readdirSync(ASSETS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function printReport(report: PackReport) {
  for (const result of report.results) {
    const tag = result.action === "processed" ? "ok      " : result.action === "skipped-exists" ? "skipped " : result.action.toUpperCase().padEnd(8);
    console.log(`  [${tag}] ${result.output}${result.message ? ` (${result.message})` : ""}`);
  }
  for (const warning of report.warnings) console.warn(`  warn    ${warning}`);
  for (const error of report.errors) console.error(`  error   ${error}`);
}

async function main(): Promise<number> {
  const args = parseArgs(Bun.argv.slice(2));
  if (args.help || (!args.pack && args.state)) {
    console.log(`usage:
  bun run cat:assets [-- --pack <name>] [-- --state <name>] [-- --force] [-- --background <#RRGGBB|none>] [-- --check]
`);
    return args.help ? 0 : 2;
  }

  const packs = args.pack ? [args.pack] : listPacks();
  if (packs.length === 0) {
    console.error(`no asset packs found in ${ASSETS_ROOT}`);
    return 1;
  }

  let failures = 0;
  for (const pack of packs) {
    const packDir = join(ASSETS_ROOT, pack);
    if (!existsSync(packDir) || !statSync(packDir).isDirectory()) {
      console.error(`error   pack "${pack}" not found in ${ASSETS_ROOT}`);
      failures++;
      continue;
    }
    console.log(`${args.check ? "check" : "process"} ${pack}/`);
    if (args.check) {
      const problems = await checkPack(packDir);
      if (problems.length === 0) console.log(`  ok      all manifest frames valid`);
      else {
        for (const problem of problems) console.error(`  error   ${problem}`);
        failures += problems.length;
      }
      continue;
    }
    const report = await processPack({
      packDir,
      states: args.state ? [args.state] : undefined,
      force: args.force,
      background: args.background,
    });
    printReport(report);
    if (report.errors.length) failures += report.errors.length;
  }
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
