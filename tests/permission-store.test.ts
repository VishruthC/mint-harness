import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionStore } from "../src/permission-store";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("PermissionStore", () => {
  test("persists exact allow-always rules", async () => {
    root = await mkdtemp(join(tmpdir(), "mint-perms-"));
    const path = join(root, "permissions.json");
    const store = new PermissionStore(path);
    expect(store.isAllowed("command:.:bun run typecheck")).toBe(false);
    store.allow("command:.:bun run typecheck", "command");
    expect(store.isAllowed("command:.:bun run typecheck")).toBe(true);
    expect(store.isAllowed("command:.:bun test")).toBe(false);

    const reloaded = new PermissionStore(path);
    expect(reloaded.isAllowed("command:.:bun run typecheck")).toBe(true);
    expect(reloaded.list()).toHaveLength(1);
  });

  test("does not duplicate the same scope", async () => {
    root = await mkdtemp(join(tmpdir(), "mint-perms-"));
    const path = join(root, "permissions.json");
    const store = new PermissionStore(path);
    store.allow("command:.:bun run typecheck", "command");
    store.allow("command:.:bun run typecheck", "command");
    expect(store.list()).toHaveLength(1);
  });
});
