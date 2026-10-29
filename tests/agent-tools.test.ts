import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, getCapabilities, getModelTools } from "../src/agent-tools";

describe("MINT harness capability registry", () => {
  test("reports only implemented tools as available", () => {
    const capabilities = getCapabilities(true);
    expect(capabilities.find((item) => item.id === "workspace.read")?.available).toBe(true);
    expect(capabilities.find((item) => item.id === "terminal.approved_execute")?.available).toBe(true);
    expect(capabilities.find((item) => item.id === "web.browse")?.available).toBe(false);
  });

  test("only exposes model-callable tools when workspace is ready", () => {
    expect(getModelTools(false)).toHaveLength(0);
    expect(getModelTools(true).map((tool) => tool.function.name)).toEqual([
      "workspace_list", "workspace_read", "workspace_search", "workspace_propose_write", "workspace_propose_patch", "workspace_project_context", "terminal_propose",
    ]);
  });

  test("generates the system prompt from actual capabilities", () => {
    const prompt = buildSystemPrompt(true, "/workspace/demo");
    expect(prompt).toContain("/workspace/demo");
    expect(prompt).toContain("workspace.propose_write");
    expect(prompt).toContain("terminal.approved_execute");
    expect(prompt).toContain("explicitly type /run");
    expect(prompt).toContain("12 tool rounds and 24 total tool calls");
  });

  test("system prompt reflects custom limits", () => {
    const prompt = buildSystemPrompt(true, "/workspace/demo", { maxToolRounds: 4, maxToolCallsPerTurn: 9 });
    expect(prompt).toContain("4 tool rounds and 9 total tool calls");
  });
});
