import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceTools } from "../src/tools";

let root = "";
let outside = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  if (outside) await rm(outside, { recursive: true, force: true });
  root = "";
  outside = "";
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "mint-workspace-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "hello.ts"), "export const greeting = 'mrrp';\n");
  await writeFile(join(root, ".env"), "NVIDIA_API_KEY=never-show-this\n");
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules", "hidden.ts"), "secretMatch\n");
  return WorkspaceTools.create(root);
}

describe("WorkspaceTools", () => {
  test("lists workspace files but excludes sensitive and ignored entries", async () => {
    const tools = await fixture();
    const result = await tools.list(".");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("src/");
      expect(result.output).not.toContain(".env");
      expect(result.output).not.toContain("node_modules");
    }
  });

  test("reads files within the workspace", async () => {
    const tools = await fixture();
    const result = await tools.read("src/hello.ts");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toContain("greeting");
  });

  test("rejects traversal and sensitive files", async () => {
    const tools = await fixture();
    expect((await tools.read("../outside.txt")).ok).toBe(false);
    expect((await tools.read(".env")).ok).toBe(false);
  });

  test("searches source text but excludes ignored and sensitive files", async () => {
    const tools = await fixture();
    const result = await tools.search("greeting");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("src/hello.ts:1");
      expect(result.output).not.toContain("never-show-this");
    }
    const hidden = await tools.search("secretMatch");
    if (hidden.ok) expect(hidden.output).not.toContain("hidden.ts");
  });


  test("previews a file replacement and applies it only after explicit approval", async () => {
    const tools = await fixture();
    const before = await tools.read("src/hello.ts");
    const proposal = await tools.proposeWrite("src/hello.ts", "export const greeting = 'hello';\n");
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.proposal.preview).toContain("-export const greeting = 'mrrp';");
    expect(proposal.proposal.preview).toContain("+export const greeting = 'hello';");
    const stillBefore = await tools.read("src/hello.ts");
    expect(stillBefore).toEqual(before);
    const applied = await tools.applyWrite(proposal.proposal.id);
    expect(applied.ok).toBe(true);
    const after = await tools.read("src/hello.ts");
    expect(after.ok && after.output).toContain("greeting = 'hello'");
  });

  test("rejecting a proposal leaves the file unchanged", async () => {
    const tools = await fixture();
    const proposal = await tools.proposeWrite("src/hello.ts", "replacement\n");
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(tools.rejectWrite(proposal.proposal.id).ok).toBe(true);
    const current = await tools.read("src/hello.ts");
    expect(current.ok && current.output).toContain("greeting = 'mrrp'");
    expect((await tools.applyWrite(proposal.proposal.id)).ok).toBe(false);
  });

  test("rejects sensitive paths and paths outside the workspace for writes", async () => {
    const tools = await fixture();
    expect((await tools.proposeWrite(".env", "changed=true")).ok).toBe(false);
    expect((await tools.proposeWrite("../outside.ts", "nope")).ok).toBe(false);
  });

  test("does not apply a proposal if the target changed after preview", async () => {
    const tools = await fixture();
    const proposal = await tools.proposeWrite("src/hello.ts", "new content\n");
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    await writeFile(join(root, "src", "hello.ts"), "external modification\n");
    const applied = await tools.applyWrite(proposal.proposal.id);
    expect(applied.ok).toBe(false);
    const current = await tools.read("src/hello.ts");
    expect(current.ok && current.output).toContain("external modification");
  });

  test("rejects symlinks pointing outside the workspace", async () => {
    const tools = await fixture();
    outside = await mkdtemp(join(tmpdir(), "mint-outside-"));
    await writeFile(join(outside, "leak.txt"), "outside workspace");
    await symlink(outside, join(root, "external"));
    expect((await tools.list("external")).ok).toBe(false);
    expect((await tools.read("external/leak.txt")).ok).toBe(false);
  });
});
