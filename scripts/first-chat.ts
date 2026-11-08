#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config";

export function firstChatWorkspace(repoRoot: string): string {
  return join(repoRoot, "initial chat");
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..");
  const workspace = firstChatWorkspace(repoRoot);
  const envPath = join(repoRoot, ".env");

  // Keep MINT's config and dependency resolution rooted in the harness while the
  // child process works inside `initial chat`.
  process.chdir(repoRoot);

  try {
    loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown configuration error";
    console.error(`MINT cannot start yet: ${message}`);
    if (existsSync(envPath)) {
      console.error(`Update ${envPath} and run \`bun run first-chat\` again.`);
    } else {
      console.error("");
      console.error("Create the config file first:");
      console.error("  PowerShell:  Copy-Item .env.example .env; notepad .env");
      console.error("  macOS/Linux: cp .env.example .env; ${EDITOR:-nano} .env");
    }
    process.exit(1);
  }

  mkdirSync(workspace, { recursive: true });

  console.log(`Starting MINT in ${workspace}`);

  const child = Bun.spawn([process.execPath, "--cwd", repoRoot, "src/index.tsx"], {
    cwd: repoRoot,
    env: { ...process.env, MINT_WORKSPACE: workspace },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  process.exitCode = await child.exited;
}

if (import.meta.main) {
  await main();
}
