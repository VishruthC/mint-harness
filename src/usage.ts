/** Token usage helpers for MINT's per-session accounting. */

export type TokenUsage = {
  prompt: number;
  completion: number;
  total: number;
};

export const EMPTY_TOKEN_USAGE: TokenUsage = Object.freeze({
  prompt: 0,
  completion: 0,
  total: 0,
});

function toCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Normalize a provider usage object (snake_case or camelCase) into a
 * TokenUsage. Returns null when nothing useful was reported.
 */
export function normalizeTokenUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const prompt = toCount(record.prompt_tokens ?? record.promptTokens);
  const completion = toCount(record.completion_tokens ?? record.completionTokens);
  const reportedTotal = toCount(record.total_tokens ?? record.totalTokens);
  const total = reportedTotal || prompt + completion;
  if (prompt === 0 && completion === 0 && total === 0) return null;
  return { prompt, completion, total };
}

export function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    prompt: left.prompt + right.prompt,
    completion: left.completion + right.completion,
    total: left.total + right.total,
  };
}

/**
 * Compact, footer-friendly rendering of a token count.
 * 0 -> "0", 999 -> "999", 1234 -> "1.2k", 123456 -> "123k", 1234567 -> "1.2m".
 */
export function formatTokenCount(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  const n = Math.max(0, Math.floor(value));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const rendered = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
    return `${rendered}k`;
  }
  const m = n / 1_000_000;
  const rendered = m >= 100 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, "");
  return `${rendered}m`;
}