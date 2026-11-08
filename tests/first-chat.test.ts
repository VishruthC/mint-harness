import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { firstChatWorkspace } from "../scripts/first-chat";

describe("first-chat", () => {
  test("targets the initial chat directory inside the harness", () => {
    const repoRoot = resolve(import.meta.dir, "..");
    expect(firstChatWorkspace(repoRoot)).toBe(join(repoRoot, "initial chat"));
  });
});
