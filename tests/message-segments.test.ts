import { describe, expect, test } from "bun:test";
import {
  parseMessageSegments,
  parseDiffBlock,
  splitReasoning,
} from "../src/message-segments";

describe("parseMessageSegments", () => {
  test("extracts a fenced code block with a language", () => {
    const content = "intro\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\noutro";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", content: "intro" });
    expect(segments[1]).toEqual({ type: "code", language: "ts", content: "const x = 1;\nconst y = 2;" });
    expect(segments[2]).toEqual({ type: "text", content: "outro" });
  });

  test("handles info strings with attributes", () => {
    const content = "```ts title=\"demo\"\nconst x = 1;\n```";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "code", language: "ts", content: "const x = 1;" });
  });

  test("handles tilde fences", () => {
    const content = "~~~js\nconsole.log(1);\n~~~";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "code", language: "js" });
  });

  test("handles CRLF line endings", () => {
    const content = "```diff\r\n@@ -1,1 +1,1 @@\r\n-old\r\n+new\r\n```";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("diff");
    if (segments[0].type === "diff") {
      expect(segments[0].hunks[0].lines).toHaveLength(2);
    }
  });

  test("treats an unclosed fence as code while streaming", () => {
    const content = "```ts\nconst x = 1;";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "code", language: "ts", content: "const x = 1;" });
  });

  test("handles 4-backtick fences containing triple backticks", () => {
    const content = "````md\n```\ninner\n```\n````";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: "code", language: "md", content: "```\ninner\n```" });
  });

  test("leaves a bullet list in a code block as code", () => {
    const content = "```md\n- item one\n- item two\n```";
    const segments = parseMessageSegments(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("code");
  });
});

describe("parseDiffBlock", () => {
  test("parses a unified diff with hunk headers", () => {
    const content = [
      "--- a/src/auth/session.ts",
      "+++ b/src/auth/session.ts",
      "@@ -40,3 +40,3 @@",
      " const row = await db.get(token);",
      "-if (!token) return null;",
      "+if (!token) throw new AuthError(\"missing token\");",
      " if (!row) return null;",
    ].join("\n");
    const segments = parseDiffBlock(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("diff");
    if (segments[0].type === "diff") {
      expect(segments[0].file).toBe("src/auth/session.ts");
      const lines = segments[0].hunks[0].lines;
      expect(lines).toHaveLength(4);
      expect(lines[1]).toMatchObject({ type: "remove", oldLineNum: 41 });
      expect(lines[2]).toMatchObject({ type: "add", newLineNum: 41 });
      expect(lines[0]).toMatchObject({ type: "context", newLineNum: 40 });
      expect(lines[3]).toMatchObject({ type: "context", newLineNum: 42 });
    }
  });

  test("synthesizes a hunk for a bare +/- diff", () => {
    const content = [
      "-if (!token) return null;",
      "+if (!token) throw new AuthError(\"missing token\");",
    ].join("\n");
    const segments = parseDiffBlock(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("diff");
    if (segments[0].type === "diff") {
      expect(segments[0].hunks[0].lines).toHaveLength(2);
    }
  });

  test("falls back to code when nothing looks like a diff", () => {
    const segments = parseDiffBlock("just some text\nno markers here");
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("code");
  });

  test("handles a missing @@ count", () => {
    const content = "@@ -1 +1 @@\n-old\n+new";
    const segments = parseDiffBlock(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("diff");
    if (segments[0].type === "diff") {
      expect(segments[0].hunks[0].lines).toHaveLength(2);
    }
  });
});

describe("splitReasoning", () => {
  test("splits paired thinking tags", () => {
    const text = "before <thinking>secret</thinking> after";
    const segments = splitReasoning(text);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: "text", content: "before " });
    expect(segments[1]).toEqual({ type: "reasoning", content: "secret" });
    expect(segments[2]).toEqual({ type: "text", content: " after" });
  });

  test("handles an unclosed thinking tag", () => {
    const text = "before <thinking>streaming reasoning";
    const segments = splitReasoning(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ type: "text", content: "before " });
    expect(segments[1]).toEqual({ type: "reasoning", content: "streaming reasoning" });
  });
});