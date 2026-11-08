#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export function windowsShim(repoRoot: string): string {
  return [
    "@echo off",
    "setlocal",
    'set "MINT_WORKSPACE=%CD%"',
    `bun --cwd "${repoRoot}" src/index.tsx %*`,
    "endlocal & exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function unixShim(repoRoot: string): string {
  return [
    "#!/bin/sh",
    'MINT_WORKSPACE="$(pwd)"',
    "export MINT_WORKSPACE",
    `exec bun --cwd ${shellQuote(repoRoot)} src/index.tsx "$@"`,
    "",
  ].join("\n");
}

export function shimContent(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? windowsShim(repoRoot) : unixShim(repoRoot);
}

function resolveBunBin(repoRoot: string): string {
  const configured = process.env.MINT_BUN_BIN?.trim();
  if (configured) return resolve(configured);

  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "pm", "bin", "-g"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = result.stdout
      .toString()
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (result.exitCode === 0 && output) {
      return resolve(output.replace(/^"(.*)"$/, "$1"));
    }
  } catch {
    // Fall through to the standard Bun locations below.
  }

  const bunInstall = process.env.BUN_INSTALL?.trim();
  if (bunInstall) return join(bunInstall, "bin");
  return join(homedir(), ".bun", "bin");
}

function pathEntries(): string[] {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean)
    .map((entry) => resolve(entry));
}

function isOnPath(directory: string): boolean {
  const target = resolve(directory);
  return pathEntries().some((entry) =>
    process.platform === "win32"
      ? entry.toLowerCase() === target.toLowerCase()
      : entry === target,
  );
}

function main(): void {
  const repoRoot = resolve(import.meta.dir, "..");
  const binDir = resolveBunBin(repoRoot);
  mkdirSync(binDir, { recursive: true });

  const target = join(binDir, process.platform === "win32" ? "minth.cmd" : "minth");
  const content = shimContent(repoRoot);
  const previous = existsSync(target) ? readFileSync(target, "utf8") : undefined;

  if (previous === content) {
    console.log(`minth is already installed: ${target}`);
  } else {
    writeFileSync(target, content, "utf8");
    if (process.platform !== "win32") chmodSync(target, 0o755);
    console.log(`Installed minth: ${target}`);
  }

  console.log(`Harness: ${repoRoot}`);
  console.log("Launch from any directory with: minth");

  if (!isOnPath(binDir)) {
    console.warn("");
    console.warn(`Note: ${binDir} is not on PATH.`);
    if (process.platform === "win32") {
      console.warn("Add that directory to PATH, then reopen your terminal to run `minth`.");
    } else {
      console.warn(`Add it with: export PATH="${binDir}:$PATH"`);
    }
  }
}

if (import.meta.main) {
  main();
}
