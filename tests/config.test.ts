import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig, writeDotEnv, updateDotEnvModel, type MintConfig } from "../src/config";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory = "";
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

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

describe("writeDotEnv", () => {
  test("creates .env with all MINT keys", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const envPath = join(directory, ".env");
    const config: MintConfig = {
      apiKey: "nvapi-testkey123",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      preferredModel: "meta/llama-3.3-70b",
      maxToolRounds: 10,
      maxToolCallsPerTurn: 20,
    };
    writeDotEnv(config, envPath);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain('NVIDIA_API_KEY="nvapi-testkey123"');
    expect(content).toContain('NVIDIA_BASE_URL="https://integrate.api.nvidia.com/v1"');
    expect(content).toContain('NVIDIA_MODEL="meta/llama-3.3-70b"');
    expect(content).toContain("MINT_MAX_TOOL_ROUNDS=10");
    expect(content).toContain("MINT_MAX_TOOL_CALLS_PER_TURN=20");
  });

  test("preserves unrelated .env entries and comments", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const envPath = join(directory, ".env");
    // Pre-populate with unrelated content
    writeFileSync(envPath, "# Comment\nUNRELATED_KEY=value\n\nNVIDIA_API_KEY=\"old\"\n");
    const config: MintConfig = {
      apiKey: "nvapi-newkey",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      preferredModel: "",
      maxToolRounds: 12,
      maxToolCallsPerTurn: 24,
    };
    writeDotEnv(config, envPath);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain("# Comment");
    expect(content).toContain("UNRELATED_KEY=value");
    expect(content).toContain('NVIDIA_API_KEY="nvapi-newkey"');
    expect(content).not.toContain('NVIDIA_API_KEY="old"');
  });

  test("handles quotes in values", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const envPath = join(directory, ".env");
    const config: MintConfig = {
      apiKey: 'key"with"quotes',
      baseUrl: "https://integrate.api.nvidia.com/v1",
      preferredModel: 'model"with"quotes',
      maxToolRounds: 12,
      maxToolCallsPerTurn: 24,
    };
    writeDotEnv(config, envPath);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain('NVIDIA_API_KEY="key\\"with\\"quotes"');
    expect(content).toContain('NVIDIA_MODEL="model\\"with\\"quotes"');
  });
});

describe("updateDotEnvModel", () => {
  test("updates only NVIDIA_MODEL", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const envPath = join(directory, ".env");
    writeFileSync(envPath, 'NVIDIA_API_KEY="secret"\nNVIDIA_BASE_URL="https://api.test/v1"\nNVIDIA_MODEL="old-model"\nUNRELATED=keep\n');
    updateDotEnvModel("new-model", envPath);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain('NVIDIA_API_KEY="secret"');
    expect(content).toContain('NVIDIA_BASE_URL="https://api.test/v1"');
    expect(content).toContain('NVIDIA_MODEL="new-model"');
    expect(content).toContain("UNRELATED=keep");
  });

  test("creates .env if missing", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const envPath = join(directory, ".env");
    updateDotEnvModel("brand-new-model", envPath);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain('NVIDIA_MODEL="brand-new-model"');
    expect(content).not.toContain("NVIDIA_API_KEY");
  });

  test("rejects invalid model IDs", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const envPath = join(directory, ".env");
    expect(() => updateDotEnvModel("", envPath)).toThrow("Invalid model ID");
    expect(() => updateDotEnvModel("model\nwith\nnewline", envPath)).toThrow("Invalid model ID");
    expect(() => updateDotEnvModel("model\rwith\rcarriage", envPath)).toThrow("Invalid model ID");
  });
});
