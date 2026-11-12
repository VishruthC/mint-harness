#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bundledMain = join(root, "dist", "index.js");
const sourceMain = join(root, "src", "index.tsx");
// The bundle is built at pack time. Source remains the fallback for repo runs
// where dist/ has not been generated yet.
const mainPath = existsSync(bundledMain) ? bundledMain : sourceMain;

// The launcher runs with the package root as cwd so dependencies and bunfig
// resolve predictably. The project the user invoked MINT from is passed
// separately and drives the workspace, `.env`, and session scoping.
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

const child = spawn(bun, [mainPath], {
  cwd: root,
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
