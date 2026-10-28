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
  });

  test("trims a custom base URL trailing slash", () => {
    const config = loadConfig({
      NVIDIA_API_KEY: "test-key",
      NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1/",
    });
    expect(config.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });
});
