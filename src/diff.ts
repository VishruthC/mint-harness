import type { DiffHunk, DiffLine } from "./message-segments";

export interface UnifiedDiff {
  diff: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  totalLines: number;
}

function normalizeLines(content: string | null): string[] {
  if (content === null) return [];
  const text = content.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function buildUnifiedDiff(path: string, oldContent: string | null, newContent: string, context = 3): UnifiedDiff {
  const oldLines = normalizeLines(oldContent);
  const newLines = normalizeLines(newContent);
  const m = oldLines.length;
  const n = newLines.length;

  // LCS table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  type Op = { type: "context" | "add" | "remove"; oldLine?: number; newLine?: number; content: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "context", oldLine: i + 1, newLine: j + 1, content: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", oldLine: i + 1, content: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "add", newLine: j + 1, content: newLines[j] });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: "remove", oldLine: i + 1, content: oldLines[i] });
    i++;
  }
  while (j < n) {
    ops.push({ type: "add", newLine: j + 1, content: newLines[j] });
    j++;
  }

  const changedIndices = ops.map((op, idx) => (op.type !== "context" ? idx : -1)).filter((x) => x >= 0);

  if (changedIndices.length === 0) {
    return { diff: "", hunks: [], additions: 0, deletions: 0, totalLines: 0 };
  }

  // Group changed lines into hunks with `context` lines of surrounding context.
  const groups: [number, number][] = [];
  let start = Math.max(0, changedIndices[0] - context);
  let end = Math.min(ops.length - 1, changedIndices[0] + context);
  for (let k = 1; k < changedIndices.length; k++) {
    const ci = changedIndices[k];
    const newStart = Math.max(0, ci - context);
    if (newStart <= end + 1) {
      end = Math.min(ops.length - 1, ci + context);
    } else {
      groups.push([start, end]);
      start = newStart;
      end = Math.min(ops.length - 1, ci + context);
    }
  }
  groups.push([start, end]);

  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  for (const [s, e] of groups) {
    const hunkOps = ops.slice(s, e + 1);
    const lines: DiffLine[] = [];
    let oldStart = 0;
    let newStart = 0;
    const firstOp = hunkOps[0];
    const firstOld = hunkOps.find((o) => o.oldLine !== undefined);
    const firstNew = hunkOps.find((o) => o.newLine !== undefined);
    if (firstOp.type === "add") {
      oldStart = firstOld ? firstOld.oldLine! : 0;
      newStart = firstOp.newLine ?? 1;
    } else if (firstOp.type === "remove") {
      oldStart = firstOp.oldLine ?? 1;
      newStart = firstNew ? firstNew.newLine! : 0;
    } else {
      oldStart = firstOp.oldLine ?? 1;
      newStart = firstOp.newLine ?? 1;
    }

    for (const op of hunkOps) {
      if (op.type === "context") {
        lines.push({ type: "context", content: op.content, oldLineNum: op.oldLine, newLineNum: op.newLine });
      } else if (op.type === "add") {
        lines.push({ type: "add", content: op.content, newLineNum: op.newLine });
        additions++;
      } else {
        lines.push({ type: "remove", content: op.content, oldLineNum: op.oldLine });
        deletions++;
      }
    }

    const oldLinesCount = lines.filter((l) => l.type !== "add").length;
    const newLinesCount = lines.filter((l) => l.type !== "remove").length;
    hunks.push({ oldStart, oldLines: oldLinesCount, newStart, newLines: newLinesCount, lines });
  }

  const header = oldContent === null ? `--- /dev/null\n+++ b/${path}` : `--- a/${path}\n+++ b/${path}`;
  const hunkTexts = hunks.map((h) => {
    const head = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
    const body = h.lines
      .map((l) => {
        const sign = l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
        return `${sign}${l.content}`;
      })
      .join("\n");
    return `${head}\n${body}`;
  });
  const diff = `${header}\n${hunkTexts.join("\n")}`;
  const totalLines = hunks.reduce((sum, h) => sum + h.lines.length, 0);

  return { diff, hunks, additions, deletions, totalLines };
}