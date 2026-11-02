import { describe, expect, test } from "bun:test";
import { addTokenUsage, formatTokenCount, normalizeTokenUsage } from "../src/usage";

describe("normalizeTokenUsage", () => {
  test("normalizes snake_case usage", () => {
    expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 })).toEqual({
      prompt: 10,
      completion: 2,
      total: 12,
    });
  });

  test("normalizes camelCase usage", () => {
    expect(normalizeTokenUsage({ promptTokens: 3, completionTokens: 4, totalTokens: 7 })).toEqual({
      prompt: 3,
      completion: 4,
      total: 7,
    });
  });

  test("computes total from prompt + completion when missing", () => {
    expect(normalizeTokenUsage({ prompt_tokens: 5, completion_tokens: 3 })).toEqual({
      prompt: 5,
      completion: 3,
      total: 8,
    });
  });

  test("returns null for empty or zero usage", () => {
    expect(normalizeTokenUsage(null)).toBeNull();
    expect(normalizeTokenUsage(undefined)).toBeNull();
    expect(normalizeTokenUsage({})).toBeNull();
    expect(normalizeTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).toBeNull();
  });
});

describe("addTokenUsage", () => {
  test("accumulates fields", () => {
    expect(addTokenUsage({ prompt: 1, completion: 2, total: 3 }, { prompt: 4, completion: 5, total: 6 })).toEqual({
      prompt: 5,
      completion: 7,
      total: 9,
    });
  });
});

describe("formatTokenCount", () => {
  test("formats small counts exactly", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
  });

  test("formats thousands compactly", () => {
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(12345)).toBe("12.3k");
    expect(formatTokenCount(123456)).toBe("123k");
  });

  test("formats millions compactly", () => {
    expect(formatTokenCount(1234567)).toBe("1.2m");
    expect(formatTokenCount(12345678)).toBe("12.3m");
  });

  test("guards invalid input", () => {
    expect(formatTokenCount(Number.NaN)).toBe("0");
    expect(formatTokenCount(-5)).toBe("0");
  });
});