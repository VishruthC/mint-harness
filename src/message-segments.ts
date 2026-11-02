export type DiffLine =
  | { type: "context"; content: string; oldLineNum?: number; newLineNum?: number }
  | { type: "add"; content: string; newLineNum?: number }
  | { type: "remove"; content: string; oldLineNum?: number };

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "diff"; language: string; content: string; hunks: DiffHunk[]; file?: string };

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const DIFF_META = /^(diff --git |index [0-9a-f]+\.\.|new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to |Binary files |GIT binary patch)/;

function normalize(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function isDiffMetaLine(line: string): boolean {
  return DIFF_META.test(line);
}

function extractDiffFile(lines: string[]): string | undefined {
  for (const line of lines) {
    const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (git) return git[2];
  }
  for (const line of lines) {
    const plus = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (plus && plus[1] && plus[1] !== "/dev/null") return plus[1].trim();
  }
  for (const line of lines) {
    const minus = /^--- (?:a\/)?(.+)$/.exec(line);
    if (minus && minus[1] && minus[1] !== "/dev/null") return minus[1].trim();
  }
  return undefined;
}

export function parseDiffLines(content: string, oldStart: number, newStart: number): DiffLine[] {
  const lines = content.split("\n");
  // Drop a trailing empty artifact line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const result: DiffLine[] = [];
  let oldNum = oldStart;
  let newNum = newStart;
  for (const raw of lines) {
    if (raw.startsWith("\\ No newline")) continue;
    if (raw.startsWith("+")) {
      result.push({ type: "add", content: raw.slice(1), newLineNum: newNum++ });
    } else if (raw.startsWith("-")) {
      result.push({ type: "remove", content: raw.slice(1), oldLineNum: oldNum++ });
    } else if (raw.startsWith(" ")) {
      result.push({ type: "context", content: raw.slice(1), oldLineNum: oldNum++, newLineNum: newNum++ });
    } else if (raw === "") {
      result.push({ type: "context", content: "", oldLineNum: oldNum++, newLineNum: newNum++ });
    } else {
      // Tolerate lines that lost their leading context space.
      result.push({ type: "context", content: raw, oldLineNum: oldNum++, newLineNum: newNum++ });
    }
  }
  return result;
}

export function parseDiffBlock(diffContent: string): MessageSegment[] {
  const content = normalize(diffContent);
  const lines = content.split("\n");
  const file = extractDiffFile(lines);
  const hunks: DiffHunk[] = [];

  // Parse explicit unified-diff hunks.
  let i = 0;
  while (i < lines.length) {
    const match = HUNK_HEADER.exec(lines[i]);
    if (!match) {
      i++;
      continue;
    }
    const oldStart = parseInt(match[1], 10);
    const oldLines = match[2] ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newLines = match[4] ? parseInt(match[4], 10) : 1;
    i++;
    const hunkLines: string[] = [];
    while (i < lines.length && !HUNK_HEADER.test(lines[i])) {
      hunkLines.push(lines[i]);
      i++;
    }
    hunks.push({
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines: parseDiffLines(hunkLines.join("\n"), oldStart, newStart),
    });
  }

  // Fall back to a single synthesized hunk for bare +/- diffs.
  if (hunks.length === 0) {
    const body: string[] = [];
    for (const line of lines) {
      if (isDiffMetaLine(line)) continue;
      if (/^(--- |\+\+\+ )/.test(line)) continue;
      body.push(line);
    }
    const parsed = parseDiffLines(body.join("\n"), 1, 1);
    const hasChange = parsed.some((line) => line.type !== "context");
    if (hasChange) {
      hunks.push({
        oldStart: 1,
        oldLines: parsed.filter((l) => l.type !== "add").length,
        newStart: 1,
        newLines: parsed.filter((l) => l.type !== "remove").length,
        lines: parsed,
      });
    }
  }

  if (hunks.length === 0) {
    return [{ type: "code", language: "diff", content: normalize(diffContent) }];
  }
  return [{ type: "diff", language: "diff", content: normalize(diffContent), hunks, file }];
}

export function splitReasoning(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const reasoningRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = reasoningRegex.exec(text)) !== null) {
    const [fullMatch, reasoningContent] = match;
    const matchStart = match.index;
    const matchEnd = match.index + fullMatch.length;

    if (matchStart > lastIndex) {
      const textContent = text.slice(lastIndex, matchStart);
      if (textContent.trim()) {
        segments.push({ type: "text", content: textContent });
      }
    }

    if (reasoningContent.trim()) {
      segments.push({ type: "reasoning", content: reasoningContent.trim() });
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) {
    const textContent = text.slice(lastIndex);
    // Handle an unclosed <thinking> tag so streaming reasoning still renders.
    const openMatch = textContent.match(/<thinking>/i);
    if (openMatch) {
      const idx = openMatch.index ?? 0;
      const before = textContent.slice(0, idx);
      const reasoning = textContent.slice(idx + openMatch[0].length);
      if (before.trim()) segments.push({ type: "text", content: before });
      if (reasoning.trim()) segments.push({ type: "reasoning", content: reasoning.trim() });
    } else if (textContent.trim()) {
      segments.push({ type: "text", content: textContent });
    }
  }

  if (segments.length === 0 && text.trim()) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

function looksLikeDiff(content: string): boolean {
  const lines = content.split("\n");
  const hasHunk = lines.some((line) => HUNK_HEADER.test(line));
  const hasFileHeader = lines.some((line) => /^(diff --git |--- |\+\+\+ )/.test(line));
  const adds = lines.filter((line) => /^\+/.test(line)).length;
  const removes = lines.filter((line) => /^-/.test(line)).length;
  return hasHunk || hasFileHeader || (adds > 0 && removes > 0);
}

function flushText(textBuffer: string[]): MessageSegment[] {
  const text = textBuffer.join("\n").replace(/^\n+|\n+$/g, "");
  textBuffer.length = 0;
  if (!text.trim()) return [];
  return splitReasoning(text);
}

export function parseMessageSegments(content: string): MessageSegment[] {
  const normalized = normalize(content);
  const lines = normalized.split("\n");
  const segments: MessageSegment[] = [];
  const textBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      textBuffer.push(lines[i]);
      continue;
    }
    const marker = open[2][0];
    const fenceLen = open[2].length;
    const info = open[3].trim();
    // Backtick fence info strings cannot contain backticks.
    if (marker === "`" && info.includes("`")) {
      textBuffer.push(lines[i]);
      continue;
    }

    let closeIndex = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const close = FENCE_CLOSE.exec(lines[j]);
      if (close && close[1][0] === marker && close[1].length >= fenceLen) {
        closeIndex = j;
        break;
      }
    }

    segments.push(...flushText(textBuffer));

    const codeLines = lines.slice(i + 1, closeIndex === -1 ? lines.length : closeIndex);
    const codeContent = codeLines.join("\n");
    const language = info.split(/\s+/)[0]?.toLowerCase() ?? "";

    if (language === "diff" || language === "patch" || looksLikeDiff(codeContent)) {
      segments.push(...parseDiffBlock(codeContent));
    } else {
      segments.push({ type: "code", language, content: codeContent });
    }

    i = closeIndex === -1 ? lines.length : closeIndex;
  }

  segments.push(...flushText(textBuffer));

  if (segments.length === 0) {
    return splitReasoning(normalized);
  }
  return segments;
}