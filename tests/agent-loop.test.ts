import { describe, expect, test } from "bun:test";
import { AgentTurnBudget, DEFAULT_AGENT_LOOP_LIMITS, formatAgentLimits, formatLimitMessage, RepeatedCallGuard } from "../src/agent-loop";

describe("agent turn budget", () => {
  test("defaults to twelve rounds and twenty-four calls", () => {
    expect(DEFAULT_AGENT_LOOP_LIMITS).toEqual({ maxToolRounds: 12, maxToolCallsPerTurn: 24 });
  });

  test("resets only when a new turn gets a new budget", () => {
    const firstTurn = new AgentTurnBudget();
    firstTurn.startRound();
    firstTurn.recordCalls(3);
    const nextTurn = new AgentTurnBudget();
    expect(firstTurn.callsUsed).toBe(3);
    expect(nextTurn.callsUsed).toBe(0);
    expect(nextTurn.roundsUsed).toBe(0);
  });

  test("allows exact call boundary and rejects one beyond it", () => {
    const budget = new AgentTurnBudget({ maxToolRounds: 12, maxToolCallsPerTurn: 3 });
    expect(budget.startRound()).toBe(true);
    expect(budget.recordCalls(2)).toBe(true);
    expect(budget.canAcceptCalls(1)).toBe(true);
    expect(budget.recordCalls(1)).toBe(true);
    expect(budget.recordCalls(1)).toBe(false);
    expect(budget.callsUsed).toBe(3);
    expect(formatLimitMessage("calls", budget)).toContain("3/3 used");
  });

  test("enforces exact round boundary", () => {
    const budget = new AgentTurnBudget({ maxToolRounds: 2, maxToolCallsPerTurn: 10 });
    expect(budget.startRound()).toBe(true);
    expect(budget.startRound()).toBe(true);
    expect(budget.startRound()).toBe(false);
    expect(budget.getLimitReached()).toBe("rounds");
    expect(formatLimitMessage("rounds", budget)).toContain("2/2 rounds");
  });
});

describe("formatLimitMessage includes env hint", () => {
  test("calls limit message mentions MINT_MAX_TOOL_CALLS_PER_TURN", () => {
    const budget = new AgentTurnBudget({ maxToolRounds: 12, maxToolCallsPerTurn: 3 });
    budget.startRound();
    budget.recordCalls(3);
    const msg = formatLimitMessage("calls", budget);
    expect(msg).toContain("MINT_MAX_TOOL_CALLS_PER_TURN");
    expect(msg).toContain("restart MINT");
  });

  test("rounds limit message mentions MINT_MAX_TOOL_ROUNDS", () => {
    const budget = new AgentTurnBudget({ maxToolRounds: 2, maxToolCallsPerTurn: 10 });
    budget.startRound();
    budget.startRound();
    const msg = formatLimitMessage("rounds", budget);
    expect(msg).toContain("MINT_MAX_TOOL_ROUNDS");
    expect(msg).toContain("restart MINT");
  });
});

describe("formatAgentLimits", () => {
  test("returns current limits and config keys", () => {
    const out = formatAgentLimits({ maxToolRounds: 34, maxToolCallsPerTurn: 64 });
    expect(out).toContain("34 rounds");
    expect(out).toContain("64 calls");
    expect(out).toContain("MINT_MAX_TOOL_ROUNDS");
    expect(out).toContain("MINT_MAX_TOOL_CALLS_PER_TURN");
    expect(out).toContain("restart MINT");
  });
});

describe("repeated call guard", () => {
  test("does not flag changed arguments as a repeated call", () => {
    const guard = new RepeatedCallGuard();
    expect(guard.observe("workspace_read", '{"path":"a.ts"}', "same")).toBe(false);
    expect(guard.observe("workspace_read", '{"path":"b.ts"}', "same")).toBe(false);
  });

  test("allows same call when its result changes and flags stable loops", () => {
    const guard = new RepeatedCallGuard();
    expect(guard.observe("workspace_read", '{"path":"a.ts"}', "v1")).toBe(false);
    expect(guard.observe("workspace_read", '{"path":"a.ts"}', "v2")).toBe(false);
    expect(guard.observe("workspace_read", '{"path":"a.ts"}', "v2")).toBe(false);
    expect(guard.observe("workspace_read", '{"path":"a.ts"}', "v2")).toBe(true);
  });
});
