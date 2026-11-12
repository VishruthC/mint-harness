import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig, writeDotEnv, updateDotEnvModel, type MintConfig } from "../src/config";
import { envFilePath, invocationCwd } from "../src/paths";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    expect(config.effort).toBe("max");
    expect(config.cat.transitionMs).toBe(100);
    expect(config.cat.oneShotSpeed).toBe(1);
  });

  test("accepts cat animation timing overrides", () => {
    const config = loadConfig({
      NVIDIA_API_KEY: "test-key",
      MINT_CAT_TRANSITION_MS: "0",
      MINT_CAT_ONESHOT_SPEED: "2",
    });
    expect(config.cat.transitionMs).toBe(0);
    expect(config.cat.oneShotSpeed).toBe(2);
  });

  test("rejects invalid cat animation timing", () => {
    expect(() => loadConfig({ NVIDIA_API_KEY: "test-key", MINT_CAT_TRANSITION_MS: "-1" })).toThrow();
    expect(() => loadConfig({ NVIDIA_API_KEY: "test-key", MINT_CAT_ONESHOT_SPEED: "0" })).toThrow();
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

  test("accepts valid effort values", () => {
    for (const effort of ["low", "medium", "high", "max"] as const) {
      const config = loadConfig({ NVIDIA_API_KEY: "test-key", MINT_EFFORT: effort });
      expect(config.effort).toBe(effort);
    }
  });

  test("rejects invalid effort values", () => {
    expect(() => loadConfig({ NVIDIA_API_KEY: "test-key", MINT_EFFORT: "invalid" })).toThrow();
  });
});

describe("invocation paths", () => {
  test("falls back to the process cwd", () => {
    expect(invocationCwd({})).toBe(process.cwd());
    expect(envFilePath({})).toBe(join(process.cwd(), ".env"));
  });

  test("prefers the directory the launcher recorded", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    expect(invocationCwd({ MINT_INVOCATION_CWD: directory })).toBe(resolve(directory));
    expect(envFilePath({ MINT_INVOCATION_CWD: directory })).toBe(join(resolve(directory), ".env"));
  });

  test("honors an explicit env file path", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const custom = join(directory, "custom.env");
    expect(envFilePath({ MINT_INVOCATION_CWD: tmpdir(), MINT_ENV_FILE: custom })).toBe(resolve(custom));
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
      effort: "max",
      autoApply: "manual",
      cat: { enabled: true, assetPack: "default", renderer: "auto", animation: true, scale: 1, idleFps: 0, workingFps: 0, transitionMs: 100, oneShotSpeed: 1 },
    };
    writeDotEnv(config, envPath);
    const content = readFileSync(envPath, "utf8");
    expect(content).toContain('NVIDIA_API_KEY="nvapi-testkey123"');
    expect(content).toContain('NVIDIA_BASE_URL="https://integrate.api.nvidia.com/v1"');
    expect(content).toContain('NVIDIA_MODEL="meta/llama-3.3-70b"');
    expect(content).toContain("MINT_MAX_TOOL_ROUNDS=10");
    expect(content).toContain("MINT_MAX_TOOL_CALLS_PER_TURN=20");
    expect(content).toContain("MINT_CAT_TRANSITION_MS=100");
    expect(content).toContain("MINT_CAT_ONESHOT_SPEED=1");
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
      effort: "max",
      autoApply: "manual",
      cat: { enabled: true, assetPack: "default", renderer: "auto", animation: true, scale: 1, idleFps: 0, workingFps: 0, transitionMs: 100, oneShotSpeed: 1 },
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
      effort: "max",
      autoApply: "manual",
      cat: { enabled: true, assetPack: "default", renderer: "auto", animation: true, scale: 1, idleFps: 0, workingFps: 0, transitionMs: 100, oneShotSpeed: 1 },
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
