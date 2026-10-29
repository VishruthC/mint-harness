export type AgentLoopLimits = {
  maxToolRounds: number;
  maxToolCallsPerTurn: number;
};

export const DEFAULT_AGENT_LOOP_LIMITS: AgentLoopLimits = {
  maxToolRounds: 12,
  maxToolCallsPerTurn: 24,
};

export type LimitReached = "rounds" | "calls";

/** Per-user-turn accounting. Create one instance for each genuinely new user message. */
export class AgentTurnBudget {
  readonly limits: AgentLoopLimits;
  roundsUsed = 0;
  callsUsed = 0;

  constructor(limits: AgentLoopLimits = DEFAULT_AGENT_LOOP_LIMITS) {
    this.limits = limits;
  }

  canStartRound(): boolean {
    return this.roundsUsed < this.limits.maxToolRounds && this.callsUsed < this.limits.maxToolCallsPerTurn;
  }

  startRound(): boolean {
    if (this.roundsUsed >= this.limits.maxToolRounds || this.callsUsed >= this.limits.maxToolCallsPerTurn) return false;
    this.roundsUsed += 1;
    return true;
  }

  canAcceptCalls(count: number): boolean {
    return Number.isInteger(count) && count >= 0 && this.callsUsed + count <= this.limits.maxToolCallsPerTurn;
  }

  recordCalls(count: number): boolean {
    if (!this.canAcceptCalls(count)) return false;
    this.callsUsed += count;
    return true;
  }

  getLimitReached(): LimitReached | undefined {
    if (this.callsUsed >= this.limits.maxToolCallsPerTurn) return "calls";
    if (this.roundsUsed >= this.limits.maxToolRounds) return "rounds";
    return undefined;
  }
}

/** A repeated call is only considered a loop when its arguments AND result stay identical. */
export class RepeatedCallGuard {
  private readonly resultsByCall = new Map<string, { result: string; repeats: number }>();

  observe(callName: string, rawArguments: string, result: string): boolean {
    const key = `${callName}\n${rawArguments}`;
    const previous = this.resultsByCall.get(key);
    if (previous && previous.result === result) {
      previous.repeats += 1;
      return previous.repeats > 2;
    }
    this.resultsByCall.set(key, { result, repeats: 1 });
    return false;
  }
}

export function formatLimitMessage(limit: LimitReached, budget: AgentTurnBudget, incomplete = "The requested task is not yet complete."): string {
  if (limit === "calls") {
    return `Tool-call limit reached: ${budget.limits.maxToolCallsPerTurn} calls per user turn (${budget.callsUsed}/${budget.limits.maxToolCallsPerTurn} used across ${budget.roundsUsed} rounds). ${incomplete} Ask me to continue to start a new turn.`;
  }
  return `Tool-round limit reached: ${budget.limits.maxToolRounds} rounds per user turn (${budget.roundsUsed}/${budget.limits.maxToolRounds} rounds; ${budget.callsUsed}/${budget.limits.maxToolCallsPerTurn} calls used). ${incomplete} Ask me to continue to start a new turn.`;
}
