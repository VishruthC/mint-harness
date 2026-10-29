import { describe, expect, test } from "bun:test";
import {
  sanitizePastedText,
  insertAtCursor,
  normalizeApiKey,
  validateConnectDraft,
  maskSecret,
  nextConnectField,
  resolveConnectModel,
  MAX_PASTE_CHARS,
} from "../src/connect";

describe("connect helpers", () => {
  describe("sanitizePastedText", () => {
    test("normalizes CRLF to LF", () => {
      const { text } = sanitizePastedText("hello\r\nworld");
      expect(text).toBe("hello\nworld");
    });

    test("normalizes CR to LF", () => {
      const { text } = sanitizePastedText("hello\rworld");
      expect(text).toBe("hello\nworld");
    });

    test("strips ANSI escape sequences", () => {
      const { text } = sanitizePastedText("\x1b[31mred\x1b[0m text");
      expect(text).toBe("red text");
    });

    test("strips OSC sequences", () => {
      const { text } = sanitizePastedText("\x1b]0;title\x07text");
      expect(text).toBe("text");
    });

    test("removes null bytes", () => {
      const { text } = sanitizePastedText("hello\0world");
      expect(text).toBe("helloworld");
    });

    test("truncates at MAX_PASTE_CHARS", () => {
      const longText = "a".repeat(MAX_PASTE_CHARS + 100);
      const { text, truncated } = sanitizePastedText(longText);
      expect(text.length).toBe(MAX_PASTE_CHARS);
      expect(truncated).toBe(true);
    });

    test("does not truncate short text", () => {
      const { text, truncated } = sanitizePastedText("short");
      expect(text).toBe("short");
      expect(truncated).toBe(false);
    });

    test("preserves unicode and emoji", () => {
      const { text } = sanitizePastedText("hello 🌍 世界");
      expect(text).toBe("hello 🌍 世界");
    });
  });

  describe("insertAtCursor", () => {
    test("inserts at beginning", () => {
      const { value, cursor } = insertAtCursor("world", 0, "hello ");
      expect(value).toBe("hello world");
      expect(cursor).toBe(6);
    });

    test("inserts at end", () => {
      const { value, cursor } = insertAtCursor("hello", 5, " world");
      expect(value).toBe("hello world");
      expect(cursor).toBe(11);
    });

    test("inserts in middle", () => {
      const { value, cursor } = insertAtCursor("heo", 1, "l");
      // cursor=1 means after first char 'h', so "h" + "l" + "eo" = "hleo"
      expect(value).toBe("hleo");
      expect(cursor).toBe(2);
    });

    test("clamps cursor to valid range", () => {
      const { value, cursor } = insertAtCursor("hi", 10, "!");
      expect(value).toBe("hi!");
      expect(cursor).toBe(3);
    });

    test("handles negative cursor", () => {
      const { value, cursor } = insertAtCursor("hi", -5, "!");
      expect(value).toBe("!hi");
      expect(cursor).toBe(1);
    });

    test("handles unicode correctly", () => {
      const { value, cursor } = insertAtCursor("🌍", 0, "🌎");
      expect(value).toBe("🌎🌍");
      // Emojis are 2 UTF-16 code units in JS
      expect(cursor).toBe(2);
    });
  });

  describe("normalizeApiKey", () => {
    test("trims whitespace", () => {
      expect(normalizeApiKey("  nvapi-key  ")).toBe("nvapi-key");
    });

    test("removes internal whitespace", () => {
      expect(normalizeApiKey("nv api key")).toBe("nvapikey");
    });

    test("handles newlines", () => {
      expect(normalizeApiKey("\nnvapi-key\n")).toBe("nvapi-key");
    });
  });

  describe("validateConnectDraft", () => {
    test("rejects short API key", () => {
      const result = validateConnectDraft("short", "https://api.nvidia.com/v1", "");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("too short");
    });

    test("rejects invalid base URL", () => {
      const result = validateConnectDraft("nvapi-validkey", "not-a-url", "");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Invalid base URL");
    });

    test("accepts valid config", () => {
      const result = validateConnectDraft("nvapi-validkey123", "https://api.nvidia.com/v1", "model-id");
      expect(result.ok).toBe(true);
    });

    test("accepts empty model", () => {
      const result = validateConnectDraft("nvapi-validkey123", "https://api.nvidia.com/v1", "");
      expect(result.ok).toBe(true);
    });
  });

  describe("maskSecret", () => {
    test("masks with bullets", () => {
      expect(maskSecret("secret")).toBe("••••••");
    });

    test("handles empty string", () => {
      expect(maskSecret("")).toBe("");
    });
  });

  describe("nextConnectField", () => {
    test("cycles forward", () => {
      expect(nextConnectField("apiKey", false)).toBe("baseUrl");
      expect(nextConnectField("baseUrl", false)).toBe("model");
      expect(nextConnectField("model", false)).toBe("apiKey");
    });

    test("cycles backward with shift", () => {
      expect(nextConnectField("apiKey", true)).toBe("model");
      expect(nextConnectField("model", true)).toBe("baseUrl");
      expect(nextConnectField("baseUrl", true)).toBe("apiKey");
    });
  });

  describe("resolveConnectModel", () => {
    test("uses draft model when provided", () => {
      const result = resolveConnectModel("draft-model", "configured", ["fetched1", "fetched2"]);
      expect(result).toBe("draft-model");
    });

    test("falls back to configured model", () => {
      const result = resolveConnectModel("", "configured-model", ["fetched1", "fetched2"]);
      expect(result).toBe("configured-model");
    });

    test("falls back to first fetched model", () => {
      const result = resolveConnectModel("", "", ["fetched1", "fetched2"]);
      expect(result).toBe("fetched1");
    });

    test("returns empty when no models available", () => {
      const result = resolveConnectModel("", "", []);
      expect(result).toBe("");
    });
  });
});