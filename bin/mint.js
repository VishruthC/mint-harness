#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bundledMain = join(root, "dist", "index.js");
const sourceMain = join(root, "src", "index.tsx");
// The bundle is built at pack time. Source remains the fallback for repo runs
// where dist/ has not been generated yet.
const bundled = existsSync(bundledMain);
const mainPath = bundled ? bundledMain : sourceMain;

// Start Bun in the directory the user invoked MINT from. The package root must
// not be the process cwd on Windows: npm cannot rename a directory while it is
// some process's working directory, which breaks /update's global install.
// The Solid preload and (for source runs) tsconfig are passed by absolute path
// so startup does not depend on the package root being the cwd.
const invocationCwd = process.cwd();
const assetsPath = join(root, "src", "cat", "assets");
const envPath = join(invocationCwd, ".env");

function findBun() {
  const check = spawnSync("bun", ["--version"], { stdio: "ignore" });

  if (!check.error && check.status === 0) return "bun";

  const localBun = join(
    homedir(),
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun"
  );

  return existsSync(localBun) ? localBun : null;
}

function resolveSolidPreload() {
  try {
    const require = createRequire(import.meta.url);
    const solidEntry = require.resolve("@opentui/solid");
    const solidRoot = dirname(solidEntry);
    const metadata = JSON.parse(readFileSync(join(solidRoot, "package.json"), "utf8"));
    const relative = metadata?.exports?.["./preload"]?.bun;
    if (typeof relative === "string") {
      const candidate = join(solidRoot, relative);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Fall through to the common npm layouts below.
  }

  const candidates = [
    join(root, "node_modules", "@opentui", "solid", "scripts", "preload.js"),
    join(root, "..", "@opentui", "solid", "scripts", "preload.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const bun = findBun();

if (!bun) {
  console.log(`
🐱 MINT

Bun runtime not detected.

MINT requires Bun >= 1.3.14.

Install Bun manually from:
https://bun.sh

After installation, restart your terminal
and run "minth" again.
`);
  process.exit(1);
}

const preload = resolveSolidPreload();

if (!preload) {
  console.log(`
🐱 MINT

Could not locate the OpenTUI Solid preload.

Reinstall MINT, then try again:
  npm install -g mint-harness@latest
`);
  process.exit(1);
}

const bunArgs = [`--preload=${preload}`];
if (!bundled) bunArgs.push(`--tsconfig-override=${join(root, "tsconfig.json")}`);
bunArgs.push(mainPath);

const child = spawn(bun, bunArgs, {
  cwd: invocationCwd,
  env: {
    ...process.env,
    MINT_WORKSPACE: process.env.MINT_WORKSPACE || invocationCwd,
    MINT_INVOCATION_CWD: process.env.MINT_INVOCATION_CWD || invocationCwd,
    MINT_ENV_FILE: process.env.MINT_ENV_FILE || envPath,
    MINT_CAT_ASSETS: process.env.MINT_CAT_ASSETS || assetsPath,
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error("Could not start MINT:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
