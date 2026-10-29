import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("requires an NVIDIA API key", () => {
    expect(() => loadConfig({})).toThrow("NVIDIA_API_KEY is missing");
  });

  test("uses NVIDIA hosted endpoint by default", () => {
    const config = loadConfig({ NVIDIA_API_KEY: "test-key" });
    expect(config.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(config.apiKey).toBe("test-key");
    expect(config.maxToolRounds).toBe(12);
    expect(config.maxToolCallsPerTurn).toBe(24);
  });

  test("accepts configured positive integer agent limits", () => {
    const config = loadConfig({ NVIDIA_API_KEY: "test-key", MINT_MAX_TOOL_ROUNDS: "7", MINT_MAX_TOOL_CALLS_PER_TURN: "19" });
    expect(config.maxToolRounds).toBe(7);
    expect(config.maxToolCallsPerTurn).toBe(19);
  });

  test("rejects zero, negative, and fractional agent limits", () => {
    for (const value of ["0", "-1", "1.5", "nope"]) {
      expect(() => loadConfig({ NVIDIA_API_KEY: "test-key", MINT_MAX_TOOL_ROUNDS: value })).toThrow();
    }
    expect(() => loadConfig({ NVIDIA_API_KEY: "test-key", MINT_MAX_TOOL_CALLS_PER_TURN: "0" })).toThrow();
  });

  test("trims a custom base URL trailing slash", () => {
    const config = loadConfig({
      NVIDIA_API_KEY: "test-key",
      NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1/",
    });
    expect(config.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });
});
