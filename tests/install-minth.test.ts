import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { shimContent } from "../scripts/install-minth";

describe("install-minth", () => {
  const repoRoot = resolve(import.meta.dir, "..");

  test("writes a Windows launcher that preserves the caller workspace", () => {
    const content = shimContent(repoRoot, "win32");

    expect(content).toContain('set "MINT_WORKSPACE=%CD%"');
    expect(content).toContain("%*");
    expect(content).toContain("src/index.tsx");
    expect(content).toContain(repoRoot);
  });

  test("writes a POSIX launcher that preserves the caller workspace", () => {
    const content = shimContent(repoRoot, "linux");

    expect(content).toContain('MINT_WORKSPACE="$(pwd)"');
    expect(content).toContain('"$@"');
    expect(content).toContain("exec bun --cwd");
    expect(content).toContain("src/index.tsx");
    expect(content).toContain(repoRoot);
  });
});
