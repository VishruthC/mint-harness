import { describe, expect, test } from "bun:test";
import { ApprovedTerminal } from "../src/terminal";
import { resolve } from "node:path";

describe("ApprovedTerminal", () => {
  test("previews an allowed command but does not execute it automatically", async () => {
    const terminal = new ApprovedTerminal(process.cwd());
    const result = await terminal.propose("bun --version");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.command).toBe("bun --version");
      expect(result.proposal.cwd).toBe(".");
    }
  });

  test("rejects shell operators and unregistered executables", async () => {
    const terminal = new ApprovedTerminal(process.cwd());
    expect((await terminal.propose("bun test; del *")).ok).toBe(false);
    expect((await terminal.propose("powershell -Command whoami")).ok).toBe(false);
    expect((await terminal.propose("bun --force run clean")).ok).toBe(false);
    expect((await terminal.propose("node -e \"console.log(1)\"")).ok).toBe(false);
  });

  test("requires a single-use approval id to execute", async () => {
    const terminal = new ApprovedTerminal(process.cwd());
    expect((await terminal.runApproved("not-real")).ok).toBe(false);
    const proposed = await terminal.propose("bun --version");
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const ran = await terminal.runApproved(proposed.proposal.id);
    expect(ran.ok).toBe(true);
    expect((await terminal.runApproved(proposed.proposal.id)).ok).toBe(false);
  });
});
