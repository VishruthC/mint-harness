#!/usr/bin/env bun
// Mint Harness - Entry point for npm package
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Run the main entry point
const mainPath = join(__dirname, "..", "src", "index.tsx");

// Use bun to run the TypeScript entry point directly
const proc = Bun.spawn(["bun", "run", mainPath], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exitCode = await proc.exited;