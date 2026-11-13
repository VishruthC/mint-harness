import { describe, expect, test } from "bun:test";
import {
  sanitizePastedText,
  insertAtCursor,
  deleteBeforeCursor,
  deleteAtCursor,
  normalizeApiKey,
  validateConnectDraft,
  maskSecret,
  nextConnectField,
  pasteDestination,
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

  describe("deleteBeforeCursor (backspace)", () => {
    test("deletes character before cursor", () => {
      const { value, cursor } = deleteBeforeCursor("hello", 3);
      expect(value).toBe("helo");
      expect(cursor).toBe(2);
    });

    test("at beginning does nothing", () => {
      const { value, cursor } = deleteBeforeCursor("hello", 0);
      expect(value).toBe("hello");
      expect(cursor).toBe(0);
    });

    test("at end deletes last character", () => {
      const { value, cursor } = deleteBeforeCursor("hello", 5);
      expect(value).toBe("hell");
      expect(cursor).toBe(4);
    });

    test("clamps cursor to valid range", () => {
      const { value, cursor } = deleteBeforeCursor("hi", 10);
      expect(value).toBe("h");
      expect(cursor).toBe(1);
    });

    test("handles negative cursor", () => {
      const { value, cursor } = deleteBeforeCursor("hi", -5);
      expect(value).toBe("hi");
      expect(cursor).toBe(0);
    });

    test("handles unicode correctly", () => {
      // Emojis are surrogate pairs (2 UTF-16 code units each)
      // "🌍🌎" = \ud83c\udf0d \ud83c\udf0e, length 4 in JS
      // cursor=2 is between the two emojis, deleting the second code unit of first emoji
      const { value, cursor } = deleteBeforeCursor("🌍🌎", 2);
      expect(value).toBe("\ud83c🌎"); // Second code unit of first emoji removed
      expect(cursor).toBe(1);
    });

    test("empty string", () => {
      const { value, cursor } = deleteBeforeCursor("", 0);
      expect(value).toBe("");
      expect(cursor).toBe(0);
    });
  });

  describe("deleteAtCursor (delete key)", () => {
    test("deletes character at cursor", () => {
      const { value, cursor } = deleteAtCursor("hello", 1);
      expect(value).toBe("hllo");
      expect(cursor).toBe(1);
    });

    test("at end does nothing", () => {
      const { value, cursor } = deleteAtCursor("hello", 5);
      expect(value).toBe("hello");
      expect(cursor).toBe(5);
    });

    test("at beginning deletes first character", () => {
      const { value, cursor } = deleteAtCursor("hello", 0);
      expect(value).toBe("ello");
      expect(cursor).toBe(0);
    });

    test("clamps cursor to valid range", () => {
      const { value, cursor } = deleteAtCursor("hi", 10);
      expect(value).toBe("hi");
      expect(cursor).toBe(2);
    });

    test("handles negative cursor", () => {
      const { value, cursor } = deleteAtCursor("hi", -5);
      expect(value).toBe("i");
      expect(cursor).toBe(0);
    });

    test("handles unicode correctly", () => {
      // Emojis are surrogate pairs (2 UTF-16 code units each)
      // "🌍🌎" = \ud83c\udf0d \ud83c\udf0e, cursor=0 deletes first code unit
      const { value, cursor } = deleteAtCursor("🌍🌎", 0);
      expect(value).toBe("\udf0d🌎"); // First code unit of first emoji removed
      expect(cursor).toBe(0);
    });

    test("empty string", () => {
      const { value, cursor } = deleteAtCursor("", 0);
      expect(value).toBe("");
      expect(cursor).toBe(0);
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

  describe("pasteDestination", () => {
    test("routes bracketed paste into the connect popup", () => {
      expect(pasteDestination(true, false)).toBe("connect");
    });

    test("routes paste to the chat input when no popup is open", () => {
      expect(pasteDestination(false, false)).toBe("chat");
    });

    test("routes paste into the model picker filter", () => {
      expect(pasteDestination(false, false, true)).toBe("model");
      expect(pasteDestination(true, false, true)).toBe("connect");
    });

    test("swallows paste while the session picker is open", () => {
      expect(pasteDestination(false, true)).toBe("none");
      expect(pasteDestination(true, true)).toBe("none");
      expect(pasteDestination(false, true, true)).toBe("none");
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