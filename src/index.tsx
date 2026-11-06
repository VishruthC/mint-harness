import { render, useKeyboard, useRenderer, useTerminalDimensions, usePaste, useSelectionHandler } from "@opentui/solid";
import { For, Show, createMemo, createSignal, createEffect, onCleanup, onMount, JSX } from "solid-js";
import { loadConfig, writeDotEnv, updateDotEnvModel, updateDotEnvAutoApply, type MintConfig } from "./config";
import { AgentTurnBudget, formatAgentLimits, formatLimitMessage, RepeatedCallGuard } from "./agent-loop";
import { NvidiaClient, type ChatMessage, type NvidiaModel, type ToolCall } from "./nvidia";
import { buildSystemPrompt, executeModelTool, getCapabilities, getModelTools } from "./agent-tools";
import { SessionStore, type StoredMessage, type Session } from "./storage";
import { WorkspaceTools } from "./tools";
import { ApprovedTerminal } from "./terminal";
import { EMPTY_TOKEN_USAGE, addTokenUsage, formatTokenCount, type TokenUsage } from "./usage";
import { CAT_EXPRESSIONS, catProfileSummary, feedCat, petCat, selectCatExpression, type CatMood, type CatExpressionId } from "./cat";
import { CatPortrait } from "./cat-portrait";
import { renderCatFrame, CAT_ART_SIZE, CAT_ART_FRAMES, type CatExpression } from "./cat-art";
import type { CatProfile } from "./storage";
import {
  MAX_PASTE_CHARS,
  sanitizePastedText,
  insertAtCursor,
  deleteBeforeCursor,
  deleteAtCursor,
  normalizeApiKey,
  validateConnectDraft,
  maskSecret,
  nextConnectField,
  resolveConnectModel,
  type ConnectField,
} from "./connect";
import {
  MAX_SESSION_TITLE,
  normalizeSessionTitle,
  deriveTitleFromMessage,
} from "./session";
import {
  filterModels,
  mergeCurrentModel,
  movePickerIndex,
  pagePickerIndex,
  homeEndIndex,
  visibleWindow,
  findModel,
  isValidModelId,
} from "./models";
import { createHostClipboard, createClipboard, createRendererClipboardAdapter, decodePasteBytes, stripAnsiSequences, SyntaxStyle } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import { parseMessageSegments, parseDiffBlock, type MessageSegment } from "./message-segments";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const colors = {
  bg: "#1e1e2e",
  panel: "#242438",
  text: "#cdd6f4",
  muted: "#9399b2",
  pink: "#f5c2e7",
  lavender: "#cba6f7",
  mint: "#a6e3a1",
  peach: "#fab387",
  red: "#f38ba8",
  rule: "#3c3c50",
};
const DIFF_ADD_BG = "#21362a";
const DIFF_REMOVE_BG = "#3a2430";
const MARKDOWN_STYLES = {
  "markup.heading": { fg: colors.mint, bold: true },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.strikethrough": { fg: colors.muted, dim: true },
  "markup.raw": { fg: colors.peach, bg: "#313244" },
  "markup.link": { fg: colors.lavender, underline: true },
  "markup.link.label": { fg: colors.lavender, underline: true },
  "markup.link.url": { fg: colors.muted, underline: true },
  "markup.quote": { fg: colors.muted, italic: true },
  "markup.list": { fg: colors.peach },
  conceal: { fg: colors.muted },
};
const UI_SCALE = 0.9;
const scaledCells = (cells: number) => Math.max(1, Math.round(cells * UI_SCALE));
type Palette = typeof colors;

const markdownStyleCache = new WeakMap<CliRenderer, SyntaxStyle>();

function getMarkdownStyle(renderer: CliRenderer): SyntaxStyle {
  const cached = markdownStyleCache.get(renderer);
  if (cached) return cached;
  const style = SyntaxStyle.fromStyles(MARKDOWN_STYLES, renderer.nativeScene as any);
  markdownStyleCache.set(renderer, style);
  return style;
}

/** Read the current git branch once; empty when not a repo. */
function detectGitBranch(root: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      timeout: 300,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch && branch !== "HEAD" ? branch : "";
  } catch {
    return "";
  }
}

type ViewMessage = { role: "user" | "assistant" | "system"; content: string; kind?: "text" | "tool" | "result" | "proposal" | "approval" | "error" | "mode"; meta?: Record<string, string> };

// Message segment parsing lives in src/message-segments.ts so it can be unit-tested
// without pulling in the Solid/OpenTUI renderer.
import type { DiffHunk, DiffLine } from "./message-segments";
export type { DiffHunk, DiffLine };

function formatToolArgs(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const first = Object.values(parsed).find((v) => typeof v === "string") as string | undefined;
      if (first !== undefined) return JSON.stringify(first);
    }
  } catch {
    // fall through to raw
  }
  return trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed;
}
function renderSegment(segment: MessageSegment, colors: Palette, markdownStyle: SyntaxStyle): JSX.Element {
  switch (segment.type) {
    case "text":
      return (
        <markdown
          content={segment.content}
          syntaxStyle={markdownStyle}
          fg={colors.text}
          conceal={true}
          width="100%"
          minWidth={0}
        />
      );
    case "reasoning":
      return (
        <box flexDirection="column" gap={0} width="100%" minWidth={0} backgroundColor={colors.bg} padding={1} borderStyle="single" borderColor={colors.muted}>
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>◆ reasoning</text>
          <markdown
            content={segment.content}
            syntaxStyle={markdownStyle}
            fg={colors.muted}
            conceal={true}
            width="100%"
            minWidth={0}
          />
        </box>
      );
    case "code": {
      const lines = segment.content.replace(/\r\n?/g, "\n").split("\n");
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      if (lines.length === 0) lines.push("");
      const gutterWidth = Math.max(2, String(lines.length).length);
      const gutterText = lines
        .map((_, i) => String(i + 1).padStart(gutterWidth) + " ")
        .join("\n");
      const bodyText = lines.map((line) => (line.length ? line : " ")).join("\n");
      return (
        <box flexDirection="column" gap={0} width="100%" minWidth={0} backgroundColor={colors.bg} padding={1} borderStyle="single" borderColor={colors.muted} overflow="hidden">
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>
            {segment.language ? `◆ ${segment.language}` : "◆ code"}
          </text>
          <box flexDirection="row" width="100%" minWidth={0} overflow="hidden">
            <text fg={colors.muted} wrapMode="none" flexShrink={0}>{gutterText}</text>
            <text fg={colors.text} wrapMode="none" flexGrow={1} minWidth={0}>{bodyText}</text>
          </box>
        </box>
      );
    }
    case "diff": {
      const allLines = segment.hunks.flatMap((hunk) => hunk.lines);
      const maxLine = allLines.reduce((max, line) => {
        const n = line.type === "remove" ? (line.oldLineNum ?? 0) : (line.newLineNum ?? 0);
        return Math.max(max, n);
      }, 1);
      const gutterWidth = Math.max(2, String(maxLine).length);
      const diffTitle = segment.file ? `◆ diff · ${segment.file}` : "◆ diff";
      return (
        <box flexDirection="column" gap={0} width="100%" minWidth={0} backgroundColor={colors.bg} padding={1} borderStyle="single" borderColor={colors.muted} overflow="hidden">
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>{diffTitle}</text>
          <For each={segment.hunks}>
            {(hunk) => (
              <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </text>
                <For each={hunk.lines}>
                  {(line) => {
                    const rowBg =
                      line.type === "add" ? DIFF_ADD_BG : line.type === "remove" ? DIFF_REMOVE_BG : colors.bg;
                    const lineNo =
                      line.type === "remove" ? line.oldLineNum : line.newLineNum;
                    const sign = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
                    const contentColor =
                      line.type === "add" ? colors.mint : line.type === "remove" ? colors.red : colors.muted;
                    const signColor =
                      line.type === "add" ? colors.mint : line.type === "remove" ? colors.red : colors.muted;
                    return (
                      <box
                        flexDirection="row"
                        width="100%"
                        minWidth={0}
                        height={1}
                        minHeight={1}
                        backgroundColor={rowBg}
                        overflow="hidden"
                      >
                        <text
                          fg={colors.muted}
                          bg={rowBg}
                          wrapMode="none"
                          width={gutterWidth + 1}
                          minWidth={gutterWidth + 1}
                          textAlign="right"
                        >
                          {String(lineNo ?? "").padStart(gutterWidth) + " "}
                        </text>
                        <text
                          fg={signColor}
                          bg={rowBg}
                          wrapMode="none"
                          width={2}
                          minWidth={2}
                          textAlign="center"
                        >
                          {sign}
                        </text>
                        <text
                          fg={contentColor}
                          bg={rowBg}
                          wrapMode="none"
                          flexGrow={1}
                          minWidth={0}
                        >
                          {line.content.length ? line.content : " "}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </box>
            )}
          </For>
        </box>
      );
    }
  }
}

function ProposalCard(props: { message: ViewMessage }) {
  const message = props.message;
  const parsed = () => parseDiffBlock(message.content);
  const hunks = () => {
    const diffSeg = parsed().find((s) => s.type === "diff");
    return diffSeg && diffSeg.type === "diff" ? diffSeg.hunks : [];
  };
  const file = () => {
    const diffSeg = parsed().find((s) => s.type === "diff");
    return diffSeg && diffSeg.type === "diff" ? (diffSeg.file ?? message.meta?.path ?? "") : (message.meta?.path ?? "");
  };
  const additions = () => message.meta?.additions ?? "0";
  const deletions = () => message.meta?.deletions ?? "0";
  const totalLines = () => parseInt(message.meta?.totalLines ?? "0", 10) || 0;
  const previewLines = () => Math.min(240, hunks().reduce((s, h) => s + h.lines.length, 0));
  const status = () => message.meta?.status ?? "awaiting approval";
  const statusColor = () => status() === "applied" ? colors.mint : status() === "rejected" ? colors.muted : colors.peach;
  const allLines = () => hunks().flatMap((h) => h.lines).slice(0, 240);

  return (
    <>
      <box border={["top", "bottom", "left", "right"]} borderColor={colors.rule} backgroundColor={colors.panel} flexDirection="column" gap={0} width="100%" minWidth={0} overflow="hidden">
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} border={["bottom"]} borderColor={colors.rule}>
          <text fg={colors.muted} wrapMode="none">{message.meta?.tool ?? "proposal"}</text>
          <text fg={statusColor()} wrapMode="none">{status()}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between" gap={1} paddingLeft={1} paddingRight={1} border={["bottom"]} borderColor={colors.rule} backgroundColor={colors.bg}>
          <text fg={colors.lavender} wrapMode="none" truncate={true} flexGrow={1} minWidth={0}>{file()}</text>
          <text fg={colors.mint} wrapMode="none" flexShrink={0}>+{additions()}</text>
          <text fg={colors.red} wrapMode="none" flexShrink={0}>−{deletions()}</text>
        </box>
        <box flexDirection="column" gap={0} width="100%" minWidth={0} overflow="hidden">
          <For each={allLines()}>
            {(line) => {
              const rowBg = line.type === "add" ? DIFF_ADD_BG : line.type === "remove" ? DIFF_REMOVE_BG : colors.bg;
              const lineNo = line.type === "remove" ? line.oldLineNum : line.newLineNum;
              const sign = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
              const contentColor = line.type === "add" ? colors.mint : line.type === "remove" ? colors.red : colors.muted;
              return (
                <box flexDirection="row" width="100%" minWidth={0} height={1} minHeight={1} backgroundColor={rowBg} overflow="hidden">
                  <text fg={colors.muted} bg={rowBg} wrapMode="none" width={6} minWidth={6} textAlign="right">{String(lineNo ?? "").padStart(5) + " "}</text>
                  <text fg={contentColor} bg={rowBg} wrapMode="none" width={2} minWidth={2} textAlign="center">{sign}</text>
                  <text fg={contentColor} bg={rowBg} wrapMode="none" flexGrow={1} minWidth={0}>{line.content.length ? line.content : " "}</text>
                </box>
              );
            }}
          </For>
        </box>
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} border={["top"]} borderColor={colors.rule}>
          <text fg={colors.muted} wrapMode="none">proposal {message.meta?.id ?? ""}</text>
          <text fg={colors.muted} wrapMode="none">preview {previewLines()} / {totalLines()} lines</text>
        </box>
      </box>
      <text fg={colors.muted} wrapMode="word" width="100%">No file has been changed. Review the diff, then type /apply to approve or /reject to discard it.</text>
    </>
  );
}

function App() {
  const [input, setInput] = createSignal("");
  const [cursorPos, setCursorPos] = createSignal(0);
  const MAX_INPUT_LINES = 9;
  const cursorChar = () => input()[cursorPos()] ?? "";
  const cursorGlyph = () => {
    const ch = cursorChar();
    return ch && ch !== "\n" ? ch : " ";
  };
  const cursorAdvance = () => {
    const ch = cursorChar();
    return ch && ch !== "\n" ? 1 : 0;
  };
  const inputLines = () => input().split("\n").length;
  const atMaxLines = () => inputLines() >= MAX_INPUT_LINES;
  const [commandIndex, setCommandIndex] = createSignal(0);
  const renderer = useRenderer();
  const markdownStyle = createMemo(() => getMarkdownStyle(renderer));
  const terminal = useTerminalDimensions();
  // Keep the palette, input, and chat chrome on screen at short terminal heights.
  // Leave extra room for the palette while command suggestions are open.
  const commandLimit = () => Math.max(1, Math.min(7, terminal().height - 20));
  const commands = [
    { command: "/help", description: "Show all commands" },
    { command: "/cat", description: "Open the interactive MINT cat menu" },
    { command: "/pet", description: "Pet the MINT cat" },
    { command: "/feed", description: "Give MINT a pixel treat" },
    { command: "/expressions", description: "View and unlock cat expressions" },
    { command: "/expression ", description: "Equip an unlocked cat expression" },
    { command: "/models", description: "List NVIDIA models" },
    { command: "/model", description: "Choose a model (opens picker)" },
    { command: "/retry", description: "Retry the last user message" },
    { command: "/connect", description: "Configure NVIDIA API credentials" },
    { command: "/session", description: "List or resume sessions" },
    { command: "/sessions", description: "List or resume sessions (alias)" },
    { command: "/session new", description: "Start a fresh session" },
    { command: "/session delete ", description: "Delete a session" },
    { command: "/session rename ", description: "Rename the active session" },
    { command: "/workspace", description: "Show workspace root" },
    { command: "/capabilities", description: "Show real harness capabilities" },
    { command: "/limits", description: "Show current agent limits (rounds/calls) and config keys" },
    { command: "/project", description: "Inspect project type, manifests, README, and .gitignore" },
    { command: "/command ", description: "Preview a restricted terminal command" },
    { command: "/run", description: "Approve and run the pending command" },
    { command: "/ls ", description: "List workspace files" },
    { command: "/read ", description: "Read a workspace file" },
    { command: "/search ", description: "Search workspace text" },
    { command: "/propose ", description: "Propose a file change" },
    { command: "/apply", description: "Approve the pending change" },
    { command: "/reject", description: "Discard the pending change" },
    { command: "/cancel-write", description: "Cancel file proposal input" },
    { command: "/cancel", description: "Stop the current response" },
    { command: "/clear", description: "Start a fresh session" },
    { command: "/quit", description: "Exit MINT" },
  ];
  const commandSuggestions = createMemo(() => {
    const value = input().trimStart();
    if (!value.startsWith("/")) return [];
    // Once an argument starts, suggestions should not cover the input or steal navigation.
    if (value.includes(" ")) return [];
    // Keep the picker compact; typing filters the complete command list.
    return commands.filter((item) => item.command.trim().startsWith(value)).slice(0, commandLimit());
  });
  // Reset commandIndex when suggestions change (filter typed)
  createEffect(() => {
    commandSuggestions();
    setCommandIndex(0);
  });
  const [messages, setMessages] = createSignal<ViewMessage[]>([
    { role: "assistant", content: "mrrp! I'm MINT. Type a message to chat, or /help for commands. ♡" },
  ]);
  const [mode, setMode] = createSignal<"plan" | "build">("plan");
  const [modeLocked, setModeLocked] = createSignal(false);
  const toggleMode = () => {
    if (busy() || modeLocked()) return;
    setMode((m) => {
      const next = m === "plan" ? "build" : "plan";
      modeTransition = { from: m, to: next };
      setHistory((old) => [systemMessage(next), ...old.filter((message) => message.role !== "system")]);
      setNotice(next === "plan" ? "plan mode: read-only planning" : "build mode: full tools enabled");
      // Add visible mode transition message
      setMessages((old) => [...old, {
        role: "system",
        content: `mode switched · ${next === "plan" ? "Plan (read-only)" : "Build (editing enabled)"}`,
        kind: "mode",
        meta: { mode: next },
      }]);
      return next;
    });
  };
  const [models, setModels] = createSignal<NvidiaModel[]>([]);
  const [model, setModel] = createSignal("");
  const [status, setStatus] = createSignal("starting");
  const [busy, setBusy] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [streamingActive, setStreamingActive] = createSignal(false);
  const beginStreaming = () => {
    setStreamingContent("");
    setStreamingActive(true);
  };
  const commitStreamingAnswer = (content: string) => {
    setStreamingActive(false);
    setStreamingContent("");
    setMessages((old) => {
      const next = [...old];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && !last.kind) next[next.length - 1] = { ...last, content };
      else next.push({ role: "assistant", content });
      return next;
    });
  };
  const cancelStreamingPreview = () => {
    setStreamingActive(false);
    setStreamingContent("");
  };
  const [notice, setNotice] = createSignal("Connecting to NVIDIA…");
  let workspaceTools: WorkspaceTools | undefined;
  let terminalTools: ApprovedTerminal | undefined;
  let agentLimits = { maxToolRounds: 12, maxToolCallsPerTurn: 24 };
  let pendingProposalId: string | undefined;
  let pendingCommandId: string | undefined;
  let modeTransition: { from: "plan" | "build"; to: "plan" | "build" } | undefined;
  let lastApproval: { kind: "file" | "command"; id: string; status: string; automatic?: boolean } | undefined;
  let autoApply: "manual" | "auto" = "manual";
  
  const systemMessage = (m: "plan" | "build" = mode()): ChatMessage => ({
    role: "system",
    content: buildSystemPrompt(
      Boolean(workspaceTools),
      workspaceTools?.root,
      agentLimits,
      m,
      { modeTransition, pendingProposalId, pendingCommandId, lastApproval, autoApply }
    )
  });
  const [history, setHistory] = createSignal<ChatMessage[]>([systemMessage()]);
  const store = new SessionStore();
  const [catProfile, setCatProfile] = createSignal<CatProfile>(store.getCatProfile());
  const [catMood, setCatMood] = createSignal<CatMood>("idle");
  const [catFrame, setCatFrame] = createSignal(0);
  const [catMenuOpen, setCatMenuOpen] = createSignal(false);
  const [catMenuIndex, setCatMenuIndex] = createSignal(0);
  const [catExpressionPicker, setCatExpressionPicker] = createSignal(false);
  const [catExpressionIndex, setCatExpressionIndex] = createSignal(0);

  // Connect popup state
  const [connectOpen, setConnectOpen] = createSignal(false);
  const [connectField, setConnectField] = createSignal<ConnectField>("apiKey");
  const [connectDraft, setConnectDraft] = createSignal({ apiKey: "", baseUrl: "", model: "" });
  const [connectCursor, setConnectCursor] = createSignal({ apiKey: 0, baseUrl: 0, model: 0 });
  const [connectError, setConnectError] = createSignal("");
  const [connectBusy, setConnectBusy] = createSignal(false);
  let connectAbort: AbortController | undefined;

  // Clipboard bridge
  const [clipboard, setClipboard] = createSignal<ReturnType<typeof createClipboard> | null>(null);
  let hostClipboard: ReturnType<typeof createHostClipboard> | null = null;
  let clipboardDispose: (() => Promise<void>) | null = null;
  let lastAutoCopyText = "";
  let pasteEventCounter = 0;

  // Toast notification
  const [toast, setToast] = createSignal<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Session picker state
  const [sessionPickerOpen, setSessionPickerOpen] = createSignal(false);
  const [sessionPickerIndex, setSessionPickerIndex] = createSignal(0);
  const [sessionPickerHoverIndex, setSessionPickerHoverIndex] = createSignal(-1);
  const [sessionPickerSessions, setSessionPickerSessions] = createSignal<Session[]>([]);
  const [sessionPickerQuery, setSessionPickerQuery] = createSignal("");

  // Filtered sessions memo for type-to-filter
  const filteredSessions = createMemo(() => {
    const q = sessionPickerQuery().trim().toLowerCase();
    if (!q) return sessionPickerSessions();
    return sessionPickerSessions().filter((s) =>
      (s.title || "unnamed").toLowerCase().includes(q) ||
      (s.model || "").toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  });

  const catMenuItems = [
    { label: "Pet the cat", shortcut: "1", detail: "Give MINT some affection" },
    { label: "Feed a treat", shortcut: "2", detail: "Spend a pixel treat" },
    { label: "Expressions", shortcut: "3", detail: "Choose an unlocked look" },
    { label: "Animations", shortcut: "4", detail: "Turn motion on or off" },
    { label: "Close menu", shortcut: "5", detail: "Return to chat" },
  ];
  const saveCatProfile = (next: CatProfile) => {
    setCatProfile(next);
    store.updateCatProfile(next);
  };
  const showCatExpressions = () => {
    const profile = catProfile();
    const listing = CAT_EXPRESSIONS.map((expression, index) => {
      const unlocked = profile.unlockedExpressions.includes(expression.id);
      return `${unlocked ? "[unlocked]" : "[locked]  "} ${index + 1}. ${expression.label} (${expression.id}) — ${unlocked ? "available" : expression.unlock}`;
    }).join("\n");
    setMessages((old) => [...old, { role: "assistant", content: `MINT CAT EXPRESSIONS\n${listing}\n\nUse /expression <id> to equip an unlocked expression.\n${catProfileSummary(profile)}` }]);
  };
  const equipCatExpression = (expressionId: string) => {
    const expression = CAT_EXPRESSIONS.find((item) => item.id === expressionId);
    if (!expression) return;
    if (!catProfile().unlockedExpressions.includes(expression.id)) {
      setMessages((old) => [...old, { role: "assistant", content: `That expression is locked: ${expression.unlock}. Give the cat some affection or treats first.` }]);
      setNotice(`locked: ${expression.label}`);
      return;
    }
    const next = selectCatExpression(catProfile(), expression.id);
    saveCatProfile(next);
    setCatMood(expression.id === "zoomies" ? "zoomies" : expression.id === "love" ? "love" : "happy");
    setCatExpressionPicker(false);
    setCatMenuOpen(false);
    setMessages((old) => [...old, { role: "assistant", content: `Expression equipped: ${expression.label} ♡` }]);
    setNotice(`expression: ${expression.label}`);
  };
  const runCatAction = (action: "pet" | "feed" | "expressions" | "toggle-animations" | "close") => {
    if (action === "close") { setCatExpressionPicker(false); setCatMenuOpen(false); setNotice("cat menu closed"); return; }
    if (action === "expressions") { setCatExpressionPicker(true); setCatExpressionIndex(0); setNotice("choose an unlocked cat expression"); return; }
    if (action === "toggle-animations") {
      const next = { ...catProfile(), animationsEnabled: !catProfile().animationsEnabled };
      saveCatProfile(next);
      setCatMood("happy");
      setMessages((old) => [...old, { role: "assistant", content: `Animations ${next.animationsEnabled ? "enabled" : "disabled"}. ${next.animationsEnabled ? "*tail wiggle resumed*" : "MINT will stay still for a bit."}` }]);
      return;
    }
    const result = action === "pet" ? petCat(catProfile()) : feedCat(catProfile());
    saveCatProfile(result.profile);
    setCatMood(result.mood);
    setMessages((old) => [...old, { role: "assistant", content: `[MINT CAT] ${result.message}${result.unlocked.length ? `\n\n✨ New expression unlocked: ${result.unlocked.map((id) => CAT_EXPRESSIONS.find((item) => item.id === id)?.label ?? id).join(", ")}! Use /expressions to equip it.` : ""}\n${catProfileSummary(result.profile)}` }]);
    setNotice(action === "pet" ? "the cat is purring ♡" : "treat accepted 🍪");
  };
  let awaitingWritePath: string | undefined;
  void WorkspaceTools.create().then((tools) => {
    workspaceTools = tools;
    terminalTools = new ApprovedTerminal(tools.root);
    setWorkspaceBranch(detectGitBranch(tools.root));
    setNotice(`workspace: ${tools.root}`);
  }).catch((error) => {
    setNotice(error instanceof Error ? error.message : "Workspace initialization failed");
  });

  // Initialize clipboard bridge
  onMount(() => {
    hostClipboard = createHostClipboard({ timeoutMs: 1200 });
    const terminalAdapter = createRendererClipboardAdapter(renderer);
    const cb = createClipboard({ host: hostClipboard, terminal: terminalAdapter });
    setClipboard(cb);
    clipboardDispose = () => cb.dispose();
  });
  onCleanup(() => {
    if (clipboardDispose) clipboardDispose();
    if (toastTimer) clearTimeout(toastTimer);
  });

  // Session state - lazy creation
  const [session, setSession] = createSignal<string | null>(null);
  const [draftSessionTitle, setDraftSessionTitle] = createSignal<string>("");
  const [workspaceBranch, setWorkspaceBranch] = createSignal("");
  const [sessionTokens, setSessionTokens] = createSignal<TokenUsage>({ ...EMPTY_TOKEN_USAGE });
  let client: NvidiaClient | undefined;
  let configuredModel = "";
  let lastUserPrompt = "";
  let activeController: AbortController | undefined;
  const sidebarVisible = () => terminal().width >= 100;
  const sidebarMetrics = () => {
    const w = terminal().width;
    const h = terminal().height;
    if (w >= 160) {
      const catH = Math.min(scaledCells(20), Math.max(scaledCells(6), h - 18));
      return { visible: w >= 100, sidebarWidth: scaledCells(44), catHeight: catH };
    }
    if (w >= 128) {
      const catH = Math.min(scaledCells(16), Math.max(scaledCells(6), h - 18));
      return { visible: w >= 100, sidebarWidth: scaledCells(36), catHeight: catH };
    }
    const catH = Math.min(scaledCells(12), Math.max(scaledCells(6), h - 18));
    return { visible: w >= 100, sidebarWidth: scaledCells(32), catHeight: catH };
  };

  // Model picker state
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false);
  const [modelPickerQuery, setModelPickerQuery] = createSignal("");
  const [modelPickerIndex, setModelPickerIndex] = createSignal(0);
  const [modelPickerBusy, setModelPickerBusy] = createSignal(false);
  const [modelPickerError, setModelPickerError] = createSignal<string | null>(null);
  let modelPickerAbort: AbortController | undefined;

  // Session rename popup state
  const [renameOpen, setRenameOpen] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal("");
  const [renameError, setRenameError] = createSignal("");
  // Approximate usable text width inside the chat input box after outer padding,
  // the optional sidebar, and panel/input padding. Used to pick compact copy.
  const chatWidth = () => Math.max(0, terminal().width - (sidebarVisible() ? sidebarMetrics().sidebarWidth + 5 : 6));
  const inputHint = () =>
    chatWidth() >= 114
      ? "Enter send · Shift+Enter newline · F2 cat · Ctrl+Shift+V paste · select to copy · /retry · /cancel"
      : chatWidth() >= 84
        ? "Enter send · Shift+Enter newline · F2 cat · Ctrl+Shift+V paste · /retry · /cancel"
        : chatWidth() >= 58
          ? "Enter send · F2 cat · Ctrl+Shift+V · /cancel"
          : "Enter send · F2 cat · /cancel";
  const footerText = () =>
    terminal().width >= 78
      ? "Harness-aware tools · approval-gated file edits · NVIDIA NIM · made with ♡"
      : terminal().width >= 50
        ? "approval-gated edits · NVIDIA NIM · made with ♡"
        : terminal().width >= 26
          ? "MINT ♡ · approval-gated"
          : "MINT ♡";

  const displayModelName = (id: string): string => {
    if (!id) return "no model";
    // Strip vendor prefix (meta/, nvidia/, etc.)
    const parts = id.split("/");
    const name = parts.length > 1 ? parts[1] : parts[0];
    const brands: Record<string, string> = {
      deepseek: "DeepSeek",
      openai: "OpenAI",
      gpt: "GPT",
      llm: "LLM",
      ai: "AI",
      moe: "MoE",
    };
    // Prettify: split on dashes/underscores, capitalize words
    return name
      .split(/[-_]/)
      .map((w) => brands[w.toLowerCase()] ?? (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  };

  const effort = () => {
    try {
      const config = loadConfig();
      return config.effort;
    } catch {
      return "max";
    }
  };

  const workspaceRoot = () => {
    try {
      return workspaceTools?.root || process.cwd();
    } catch {
      return process.cwd();
    }
  };

  const workspaceLabel = () => {
    const root = workspaceRoot();
    const home = homedir();
    const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedRoot = normalize(root);
    const normalizedHome = normalize(home);
    if (normalizedRoot === normalizedHome) return "~";
    if (normalizedRoot.toLowerCase().startsWith(`${normalizedHome.toLowerCase()}/`)) {
      return `~${normalizedRoot.slice(normalizedHome.length)}`;
    }
    return root;
  };

const showTokenUsage = () => terminal().width >= 48;
  const tokenUsageLabel = () => `${formatTokenCount(sessionTokens().total)} tokens`;
  const footerLabel = () => {
    const parts = [workspaceLabel()];
    if (workspaceBranch() && terminal().width >= 60) parts.push(workspaceBranch());
    if (autoApply === "auto" && mode() === "build") parts.push("auto-apply:on");
    const full = parts.join(" · ");
    const sidebarChrome = sidebarVisible() ? sidebarMetrics().sidebarWidth + 5 : 4;
    const tokenChrome = showTokenUsage() ? tokenUsageLabel().length + 1 : 0;
    const available = Math.max(8, terminal().width - sidebarChrome - tokenChrome);
    if (full.length <= available) return full;
    // Keep the folder name and branch visible; trim the start of long paths.
    return "…" + full.slice(full.length - available + 1);
  };

  const allSessions = () => store.listSessions(50, workspaceTools?.root);

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  };

  const commandPaletteHeader = () =>
    terminal().width >= 64 ? "COMMANDS  ·  ↑/↓ select  ·  Tab complete" : "COMMANDS  ·  ↑/↓  ·  Tab";

  const modelPickerHeader = () => {
    const filtered = filterModels(mergeCurrentModel(models(), configuredModel || model() || ""), modelPickerQuery());
    const q = modelPickerQuery();
    if (terminal().width >= 72) {
      return `MODELS · ${filtered.length}${q ? ` · filter "${q}"▌` : " · type to filter · ↑/↓ · Enter"}`;
    }
    return `MODELS · ${filtered.length}${q ? ` · "${q}"` : " · ↑/↓ · Enter"}`;
  };

  // Model picker suggestions memo - full filtered list (windowing handled in render)
  const modelPickerSuggestions = createMemo(() => {
    const allModels = mergeCurrentModel(models(), configuredModel || model() || "");
    const filtered = filterModels(allModels, modelPickerQuery());
    return filtered;
  });

  createEffect(() => {
    const count = modelPickerSuggestions().length;
    const idx = modelPickerIndex();
    if (count === 0) { if (idx !== 0) setModelPickerIndex(0); return; }
    if (idx >= count) setModelPickerIndex(count - 1);
    if (idx < 0) setModelPickerIndex(0);
  });


  const [sessionTitleRevision, setSessionTitleRevision] = createSignal(0);
  const getSessionTitle = () => {
    sessionTitleRevision();
    const sid = session();
    if (sid) {
      const s = store.getSession(sid);
      return s?.title || "unnamed";
    }
    return draftSessionTitle() || "new session";
  };
  const statusColor = () => status() === "connected" ? colors.mint : status() === "error" ? colors.red : colors.peach;
  const statusGlyph = () => status() === "connected" ? "●" : status() === "error" ? "✗" : "◌";
  const statusLabel = () => status() === "connected" ? "connected" : status() === "error" ? "error" : "connecting";

  const persist = (message: StoredMessage) => {
    const sid = session();
    if (sid) {
      store.addMessage(sid, message);
    } else {
      // First message - create session with the message
      const newSession = store.createSessionWithMessage(model(), message, draftSessionTitle() || undefined, workspaceTools?.root);
      setSession(newSession.id);
      setDraftSessionTitle("");
    }
  };

  const startNewSession = () => {
    setSession(null);
    setDraftSessionTitle("");
    setHistory([systemMessage()]);
    setMessages([{ role: "assistant", content: `Fresh session! Send a message to save it. ♡` }]);
    setNotice("draft session ready");
    lastUserPrompt = "";
    pendingProposalId = undefined;
    pendingCommandId = undefined;
    awaitingWritePath = undefined;
    modeTransition = undefined;
    lastApproval = undefined;
    // Note: autoApply persists across sessions
    setSessionTokens({ ...EMPTY_TOKEN_USAGE });
  };

  const resumeSession = (id: string) => {
    const found = store.getSession(id);
    if (!found) {
      setMessages((old) => [...old, { role: "assistant", content: `No session found with ID ${id}. Use /session to list sessions.` }]);
      return;
    }
    const stored = store.getMessages(id);
    setSession(id);
    setDraftSessionTitle("");
    setHistory([systemMessage(), ...stored.filter((m) => m.role !== "system")]);
    setMessages(stored.filter((m) => m.role !== "system"));
    setModel(found.model || model());
    setNotice(`resumed session ${id}`);
    // Clear transient state on resume
    pendingProposalId = undefined;
    pendingCommandId = undefined;
    awaitingWritePath = undefined;
    modeTransition = undefined;
    lastApproval = undefined;
    setSessionTokens(store.getSessionTokenUsage(id));
  };

  const refreshModels = async () => {
    if (!client) return;
    setNotice("Fetching NVIDIA models…");
    try {
      const list = await client.listModels();
      setModels(list);
      const preferred = configuredModel;
      // Honor an explicitly configured model even if /models omits it from its catalog.
      // The catalog endpoint and chat endpoint can expose different model availability.
      const selected = preferred || model() || list[0]?.id || "";
      setModel(selected);
      setStatus("connected");
      setNotice(list.length ? `${list.length} NVIDIA models available` : "Connected, but no models were returned");
    } catch (error) {
      setStatus("error");
      setNotice(error instanceof Error ? error.message : "NVIDIA connection failed");
    }
  };

  // Track the configured base URL separately from the model
  const [configuredBaseUrl, setConfiguredBaseUrl] = createSignal("https://integrate.api.nvidia.com/v1");

  // Connect popup handlers
  const openConnectPopup = () => {
    setConnectDraft({
      apiKey: "",
      baseUrl: configuredBaseUrl() || "https://integrate.api.nvidia.com/v1",
      model: model() || configuredModel || "",
    });
    // Place cursors at the end of prefilled values
    setConnectCursor({
      apiKey: 0,
      baseUrl: (configuredBaseUrl() || "https://integrate.api.nvidia.com/v1").length,
      model: (model() || configuredModel || "").length,
    });
    setConnectField("apiKey");
    setConnectError("");
    setConnectBusy(false);
    setConnectOpen(true);
  };

  const closeConnectPopup = () => {
    if (connectAbort) {
      connectAbort.abort();
      connectAbort = undefined;
    }
    setConnectOpen(false);
    setConnectDraft({ apiKey: "", baseUrl: "", model: "" });
    setConnectCursor({ apiKey: 0, baseUrl: 0, model: 0 });
    setConnectError("");
    setConnectBusy(false);
  };

  const connectFieldValue = (field: ConnectField) => connectDraft()[field];
  const connectFieldCursor = (field: ConnectField) => connectCursor()[field];

  const setConnectFieldValue = (field: ConnectField, value: string) => {
    setConnectDraft((old) => ({ ...old, [field]: value }));
  };

  const setConnectFieldCursor = (field: ConnectField, cursor: number) => {
    setConnectCursor((old) => ({ ...old, [field]: cursor }));
  };

  const handleConnectPaste = async (text: string) => {
    if (!connectOpen()) return false;
    const field = connectField();
    const { text: sanitized, truncated } = sanitizePastedText(text);
    const cursor = connectFieldCursor(field);
    const { value, cursor: newCursor } = insertAtCursor(connectFieldValue(field), cursor, sanitized);
    setConnectFieldValue(field, value);
    setConnectFieldCursor(field, newCursor);
    if (truncated) showToast(`Paste truncated to ${MAX_PASTE_CHARS} chars`);
    return true;
  };

  const handleConnectKey = async (key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => {
    if (!connectOpen()) return false;

    const field = connectField();
    const value = connectFieldValue(field);
    const cursor = connectFieldCursor(field);

    if (key.name === "escape") {
      closeConnectPopup();
      return true;
    }
    if (key.name === "tab") {
      const next = nextConnectField(field, key.shift);
      setConnectField(next);
      return true;
    }
    if ((key.ctrl && key.name === "v") || (key.name === "insert" && key.shift)) {
      const text = await readClipboardText();
      if (text) await handleConnectPaste(text);
      return true;
    }
    if (key.name === "backspace") {
      const { value: newValue, cursor: newCursor } = deleteBeforeCursor(value, cursor);
      setConnectFieldValue(field, newValue);
      setConnectFieldCursor(field, newCursor);
      return true;
    }
    if (key.name === "delete") {
      const { value: newValue, cursor: newCursor } = deleteAtCursor(value, cursor);
      setConnectFieldValue(field, newValue);
      setConnectFieldCursor(field, newCursor);
      return true;
    }
    if (key.name === "left") {
      setConnectFieldCursor(field, Math.max(0, cursor - 1));
      return true;
    }
    if (key.name === "right") {
      setConnectFieldCursor(field, Math.min(value.length, cursor + 1));
      return true;
    }
    if (key.name === "home") {
      setConnectFieldCursor(field, 0);
      return true;
    }
    if (key.name === "end") {
      setConnectFieldCursor(field, value.length);
      return true;
    }
    if (key.name === "return") {
      await submitConnect();
      return true;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.shift) {
      const { value: newValue, cursor: newCursor } = insertAtCursor(value, cursor, key.sequence);
      setConnectFieldValue(field, newValue);
      setConnectFieldCursor(field, newCursor);
      return true;
    }
    return false;
  };

  const readClipboardText = async (): Promise<string | null> => {
    if (!clipboard()) return null;
    try {
      const result = await clipboard()!.read({
        preferredTypes: ["text/plain", "UTF8_STRING", "STRING"],
        selection: "clipboard",
      });
      if (result.status === "read") {
        return new TextDecoder().decode(result.representation.bytes);
      }
    } catch {
      // ignore
    }
    return null;
  };

  const copyText = async (text: string): Promise<boolean> => {
    if (!clipboard()) return false;
    try {
      const result = await clipboard()!.writeText(text, { destination: "best-available" });
      if (result.host?.status === "written" || result.terminal?.status === "attempted") return true;
    } catch {
      // ignore
    }
    // Fallback to OSC52
    try {
      return renderer.copyToClipboardOSC52(text);
    } catch {
      return false;
    }
  };

  const showToast = (text: string, duration = 1800) => {
    if (toastTimer) clearTimeout(toastTimer);
    setToast(text);
    toastTimer = setTimeout(() => setToast(null), duration);
  };

  const submitConnect = async () => {
    const draft = connectDraft();
    const apiKey = normalizeApiKey(draft.apiKey);
    const baseUrl = draft.baseUrl || "https://integrate.api.nvidia.com/v1";
    const model = draft.model.trim();

    const validation = validateConnectDraft(apiKey, baseUrl, model);
    if (!validation.ok) {
      setConnectError(validation.error || "Invalid configuration");
      return;
    }

    setConnectBusy(true);
    setConnectError("");
    connectAbort = new AbortController();

    try {
      const testClient = new NvidiaClient(apiKey, baseUrl);
      const list = await testClient.listModels(connectAbort.signal);
      if (list.length === 0) throw new Error("No models returned from NVIDIA");

      const resolvedModel = resolveConnectModel(model, configuredModel, list.map((m) => m.id));
      const mergedConfig: MintConfig = {
        apiKey,
        baseUrl,
        preferredModel: resolvedModel,
        maxToolRounds: agentLimits.maxToolRounds,
        maxToolCallsPerTurn: agentLimits.maxToolCallsPerTurn,
        effort: "max",
        autoApply: "manual",
      };
      writeDotEnv(mergedConfig);

      client = testClient;
      configuredModel = mergedConfig.preferredModel;
      agentLimits = { maxToolRounds: mergedConfig.maxToolRounds, maxToolCallsPerTurn: mergedConfig.maxToolCallsPerTurn };
      setModel(mergedConfig.preferredModel || list[0].id);
      setModels(list);
      setStatus("connected");
      setConfiguredBaseUrl(baseUrl);
      setNotice(`NVIDIA connected ✓ (${list.length} models)`);
      showToast(`Connected to NVIDIA ✓ (${list.length} models)`);
      closeConnectPopup();
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setConnectError(e instanceof Error ? e.message : String(e));
      showToast("Connection failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setConnectBusy(false);
      connectAbort = undefined;
    }
  };

  // Model picker handlers
  const openModelPicker = (refresh = false) => {
    setModelPickerQuery("");
    setModelPickerIndex(0);
    setModelPickerError(null);
    setModelPickerOpen(true);
    if (refresh) {
      void refreshModelPicker();
    }
  };

  const closeModelPicker = () => {
    if (modelPickerAbort) {
      modelPickerAbort.abort();
      modelPickerAbort = undefined;
    }
    setModelPickerOpen(false);
    setModelPickerQuery("");
    setModelPickerIndex(0);
    setModelPickerError(null);
    setModelPickerBusy(false);
  };

  const refreshModelPicker = async () => {
    if (!client) return;
    setModelPickerBusy(true);
    setModelPickerError(null);
    modelPickerAbort = new AbortController();
    try {
      const list = await client.listModels(modelPickerAbort.signal);
      setModels(list);
      setModelPickerError(null);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setModelPickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelPickerBusy(false);
      modelPickerAbort = undefined;
    }
  };

  const applyModel = async (modelId: string) => {
    if (!isValidModelId(modelId)) {
      setMessages((old) => [...old, { role: "assistant", content: "Invalid model ID." }]);
      return;
    }
    try {
      updateDotEnvModel(modelId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update .env";
      setMessages((old) => [...old, { role: "assistant", content: `Failed to save model: ${msg}` }]);
      showToast(`Failed to save model: ${msg}`);
      return;
    }
    setModel(modelId);
    configuredModel = modelId;
    if (session()) {
      store.updateModel(session()!, modelId);
    }
    setNotice(`Model set to ${modelId} · saved to .env`);
    showToast(`♡ model → ${modelId} · saved to .env`);
    closeModelPicker();
  };

  const handleModelPickerKey = (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => {
    if (!modelPickerOpen()) return false;

    const allModels = mergeCurrentModel(models(), configuredModel || model() || "");
    const filtered = filterModels(allModels, modelPickerQuery());
    const count = filtered.length;
    let index = modelPickerIndex();

    if (key.name === "escape") {
      closeModelPicker();
      return true;
    }
    if (key.name === "up") {
      setModelPickerIndex(movePickerIndex(index, -1, count));
      return true;
    }
    if (key.name === "down") {
      setModelPickerIndex(movePickerIndex(index, 1, count));
      return true;
    }
    if (key.name === "pageup") {
      const pageSize = commandLimit();
      setModelPickerIndex(pagePickerIndex(index, pageSize, count, -1));
      return true;
    }
    if (key.name === "pagedown") {
      const pageSize = commandLimit();
      setModelPickerIndex(pagePickerIndex(index, pageSize, count, 1));
      return true;
    }
    if (key.name === "home") {
      setModelPickerIndex(homeEndIndex(index, count, true));
      return true;
    }
    if (key.name === "end") {
      setModelPickerIndex(homeEndIndex(index, count, false));
      return true;
    }
    if (key.name === "return") {
      const selected = filtered[index];
      if (selected) {
        void applyModel(selected.id);
      }
      return true;
    }
    if ((key.ctrl && key.name === "r") || (key.ctrl && key.shift && key.name === "r")) {
      void refreshModelPicker();
      return true;
    }
    if (key.name === "backspace") {
      setModelPickerQuery((q) => q.slice(0, -1));
      setModelPickerIndex(0);
      return true;
    }
    if (key.ctrl && key.name === "u") {
      setModelPickerQuery("");
      setModelPickerIndex(0);
      return true;
    }
    // Paste into model picker filter (Ctrl+Shift+V, Shift+Insert, Ctrl+V)
    if ((key.ctrl && key.shift && key.name === "v") || (key.ctrl && key.name === "v") || (key.name === "insert" && key.shift)) {
      void readClipboardText().then((text) => {
        if (text) {
          const { text: sanitized, truncated } = sanitizePastedText(text);
          if (sanitized) {
            setModelPickerQuery((q) => q + sanitized);
            setModelPickerIndex(0);
            if (truncated) showToast(`Paste truncated to ${MAX_PASTE_CHARS} chars`);
          }
        }
      });
      return true;
    }
    const pickerChar = key.sequence && key.sequence.length === 1 ? key.sequence : (key.name && key.name.length === 1 ? key.name : "");
    if (pickerChar && !key.ctrl) {
      setModelPickerQuery((q) => q + pickerChar);
      setModelPickerIndex(0);
      return true;
    }
    return false;
  };

  // Session rename popup handlers
  const openRenamePopup = () => {
    const currentTitle = session() ? store.getSession(session()!)?.title || "" : draftSessionTitle();
    setRenameDraft(currentTitle);
    setRenameError("");
    setRenameOpen(true);
  };

  const closeRenamePopup = () => {
    setRenameOpen(false);
    setRenameDraft("");
    setRenameError("");
  };

  const applyRename = () => {
    const title = normalizeSessionTitle(renameDraft());
    if (!title) {
      setRenameError("Name cannot be empty");
      return;
    }
    const sid = session();
    if (sid) {
      store.renameSession(sid, title);
      setDraftSessionTitle(title);
      setSessionTitleRevision((v) => v + 1);
      setNotice(`Session renamed to "${title}"`);
      showToast(`♡ session renamed: ${title}`);
    } else {
      setDraftSessionTitle(title);
      setNotice(`Draft session named "${title}"`);
      showToast(`♡ draft session named: ${title}`);
    }
    closeRenamePopup();
  };

  const handleRenameKey = (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => {
    if (!renameOpen()) return false;

    if (key.name === "escape") {
      closeRenamePopup();
      return true;
    }
    if (key.name === "return") {
      applyRename();
      return true;
    }
    if (key.name === "backspace") {
      setRenameDraft((d) => d.slice(0, -1));
      setRenameError("");
      return true;
    }
    if (key.ctrl && key.name === "u") {
      setRenameDraft("");
      setRenameError("");
      return true;
    }
    if ((key.ctrl && key.name === "v") || (key.name === "insert" && key.shift)) {
      void readClipboardText().then((text) => {
        if (text) {
          const { text: sanitized } = sanitizePastedText(text);
          setRenameDraft((d) => d + sanitized);
        }
      });
      return true;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
      setRenameDraft((d) => d + key.sequence);
      setRenameError("");
      return true;
    }
    return false;
  };

  // Session command handlers
  const handleSessionCommand = async (text: string) => {
    const parts = text.trim().split(/\s+/);
    const sub = parts[1] || "";
    if (!sub || sub === "list") {
      openSessionPicker();
      return;
    }
    if (sub === "new") {
      startNewSession();
      return;
    }
    if (sub === "delete" && parts[2]) {
      const id = parts[2];
      store.deleteSession(id);
      setMessages((old) => [...old, { role: "assistant", content: `Session ${id} deleted.` }]);
      setNotice(`session ${id} deleted`);
      return;
    }
    if (sub === "rename") {
      if (parts.length > 2) {
        const newTitle = parts.slice(2).join(" ");
        const normalized = normalizeSessionTitle(newTitle);
        if (!normalized) {
          setMessages((old) => [...old, { role: "assistant", content: "Session name cannot be empty." }]);
          return;
        }
        const sid = session();
        if (sid) {
          store.renameSession(sid, normalized);
          setDraftSessionTitle(normalized);
          setSessionTitleRevision((v) => v + 1);
          setNotice(`Session renamed to "${normalized}"`);
          showToast(`♡ session renamed: ${normalized}`);
        } else {
          setDraftSessionTitle(normalized);
          setNotice(`Draft session named "${normalized}"`);
          showToast(`♡ draft session named: ${normalized}`);
        }
      } else {
        openRenamePopup();
      }
      return;
    }
    // Treat as session ID to resume
    resumeSession(sub);
  };

  const openSessionPicker = () => {
    const sessions = store.listSessions(50, workspaceTools?.root);
    setSessionPickerSessions(sessions);
    setSessionPickerQuery("");
    setSessionPickerHoverIndex(-1);
    // Pre-select current session if it exists in the list
    const currentSid = session();
    if (currentSid) {
      const idx = sessions.findIndex((s) => s.id === currentSid);
      if (idx >= 0) setSessionPickerIndex(idx);
    } else {
      setSessionPickerIndex(0);
    }
    setSessionPickerOpen(true);
    setNotice("session picker open");
  };

  const closeSessionPicker = () => {
    setSessionPickerOpen(false);
    setSessionPickerSessions([]);
    setSessionPickerHoverIndex(-1);
    setNotice("session picker closed");
  };

  const handleSessionPickerInput = async (text: string) => {
    // In the picker, we interpret input as navigation or direct selection
    const sessions = sessionPickerSessions();
    if (sessions.length === 0) {
      closeSessionPicker();
      return;
    }
    if (text === "escape" || text === "esc") {
      closeSessionPicker();
      return;
    }
    if (text === "up" || text === "k") {
      setSessionPickerIndex((old) => (old - 1 + sessions.length) % sessions.length);
      return;
    }
    if (text === "down" || text === "j") {
      setSessionPickerIndex((old) => (old + 1) % sessions.length);
      return;
    }
    if (text === "enter" || text === "") {
      const selected = sessions[sessionPickerIndex()];
      if (selected) {
        closeSessionPicker();
        resumeSession(selected.id);
      }
      return;
    }
    // Allow direct number entry
    const num = parseInt(text, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      closeSessionPicker();
      resumeSession(sessions[num - 1].id);
      return;
    }
  };

  const send = async () => {
    const rawText = input();
    const text = rawText.trim();

    if ((!text && !awaitingWritePath) || (busy() && text !== "/cancel")) return;

    if ((!text && !awaitingWritePath) || (busy() && text !== "/cancel")) return;

    setInput("");
    setCursorPos(0);

    if (text === "/quit" || text === "/exit") {
      activeController?.abort();
      store.close();
      renderer.destroy();
      return;
    }
    if (text === "/cat") {
      setCatMenuOpen((open) => !open);
      setCatExpressionPicker(false);
      setCatMenuIndex(0);
      setNotice(catMenuOpen() ? "cat menu closed" : "cat menu opened · use ↑/↓ and Enter");
      return;
    }
    if (text === "/pet") { runCatAction("pet"); return; }
    if (text === "/feed") { runCatAction("feed"); return; }
    if (text === "/expressions") { showCatExpressions(); return; }
    if (text.startsWith("/expression ")) {
      const requested = text.slice(12).trim().toLowerCase();
      const expression = CAT_EXPRESSIONS.find((item) => item.id === requested || item.label.toLowerCase() === requested);
      if (!expression) {
        setMessages((old) => [...old, { role: "assistant", content: "Unknown expression. Use /expressions to see the list." }]);
      } else equipCatExpression(expression.id);
      return;
    }
    if (text === "/retry") {
      if (!lastUserPrompt) {
        setMessages((old) => [...old, { role: "assistant", content: "There is no previous user message to retry yet." }]);
        return;
      }
      setInput(lastUserPrompt);
      setCursorPos(lastUserPrompt.length);
      queueMicrotask(() => void send());
      return;
    }
    if (text === "/cancel") {
      if (activeController) {
        activeController.abort();
        setNotice("cancelling request…");
      } else {
        setNotice("nothing to cancel ♡");
      }
      return;
    }
    if (text === "/cancel-write") {
      awaitingWritePath = undefined;
      if (pendingProposalId && workspaceTools) workspaceTools.rejectWrite(pendingProposalId);
      pendingProposalId = undefined;
      setNotice("pending file change discarded");
      setMessages((old) => [...old, { role: "assistant", content: "Okay ♡ no file was changed." }]);
      return;
    }
    if (awaitingWritePath !== undefined) {
      const targetPath = awaitingWritePath;
      awaitingWritePath = undefined;
      if (!workspaceTools) {
        setMessages((old) => [...old, { role: "assistant", content: "Workspace is not ready; no file was changed." }]);
        return;
      }
      const result = await workspaceTools.proposeWrite(targetPath, rawText);
      if (!result.ok) {
        setMessages((old) => [...old, { role: "assistant", content: `Could not prepare change: ${result.error}` }]);
        setNotice("proposal failed");
        return;
      }
      pendingProposalId = result.proposal.id;
      setMessages((old) => [...old, {
        role: "assistant",
        content: result.proposal.preview,
        kind: "proposal",
        meta: {
          id: result.proposal.id,
          path: result.proposal.path,
          tool: "workspace_propose_write",
          status: "awaiting approval",
          additions: String(result.proposal.additions ?? 0),
          deletions: String(result.proposal.deletions ?? 0),
          totalLines: String(result.proposal.totalLines ?? 0),
        },
      }]);
      
      // Auto-apply if enabled and in build mode
      if (autoApply === "auto" && mode() === "build") {
        const applyResult = await workspaceTools.applyWrite(result.proposal.id);
        if (applyResult.ok) {
          pendingProposalId = undefined;
          lastApproval = { kind: "file", id: result.proposal.id, status: "applied", automatic: true };
          setMessages((old) => old.map((m) => (m.meta?.id === result.proposal.id ? { ...m, meta: { ...m.meta, status: "applied automatically" } } : m)));
          setMessages((old) => [...old, { role: "assistant", content: `PROPOSAL AUTO-APPLIED — ${applyResult.output}` }]);
          setCatMood("happy");
          setNotice("approved change applied automatically");
        } else {
          setMessages((old) => old.map((m) => (m.meta?.id === result.proposal.id ? { ...m, meta: { ...m.meta, status: "auto-apply failed · awaiting approval" } } : m)));
          setMessages((old) => [...old, { role: "assistant", content: `Auto-apply failed: ${applyResult.error}. The proposal is still pending — use /apply to approve or /reject to discard.` }]);
          setNotice("auto-apply failed");
        }
      } else {
        setNotice(`review proposal ${result.proposal.id}`);
      }
      return;
    }
    if (text === "/apply") {
      if (!workspaceTools || !pendingProposalId) {
        setMessages((old) => [...old, { role: "assistant", content: "There is no pending file change to apply." }]);
        return;
      }
      const proposalId = pendingProposalId;
      const result = await workspaceTools.applyWrite(proposalId);
      if (result.ok) {
        setMessages((old) => old.map((m) => (m.meta?.id === proposalId ? { ...m, meta: { ...m.meta, status: "applied" } } : m)));
      }
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Change not applied: ${result.error}` }]);
      if (result.ok) { pendingProposalId = undefined; lastApproval = { kind: "file", id: proposalId, status: "applied" }; setCatMood("happy"); }
      else { setCatMood("error"); lastApproval = { kind: "file", id: proposalId, status: "failed" }; }
      setNotice(result.ok ? "approved change applied" : "approval failed");
      return;
    }
    if (text === "/reject") {
      if (!workspaceTools || !pendingProposalId) {
        setMessages((old) => [...old, { role: "assistant", content: "There is no pending file change to reject." }]);
        return;
      }
      const proposalId = pendingProposalId;
      const result = workspaceTools.rejectWrite(proposalId);
      setMessages((old) => old.map((m) => (m.meta?.id === proposalId ? { ...m, meta: { ...m.meta, status: "rejected" } } : m)));
      pendingProposalId = undefined;
      lastApproval = { kind: "file", id: proposalId, status: "rejected" };
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : result.error }]);
      setNotice("proposal rejected");
      return;
    }
    if (text === "/approve") {
      if (!workspaceTools || !pendingProposalId) {
        setMessages((old) => [...old, { role: "assistant", content: "There is no pending file change to approve." }]);
        return;
      }
      const proposalId = pendingProposalId;
      const result = await workspaceTools.applyWrite(proposalId);
      if (result.ok) {
        setMessages((old) => old.map((m) => (m.meta?.id === proposalId ? { ...m, meta: { ...m.meta, status: "applied" } } : m)));
      }
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Change not applied: ${result.error}` }]);
      if (result.ok) { pendingProposalId = undefined; lastApproval = { kind: "file", id: proposalId, status: "applied" }; setCatMood("happy"); }
      else { setCatMood("error"); lastApproval = { kind: "file", id: proposalId, status: "failed" }; }
      setNotice(result.ok ? "approved change applied" : "approval failed");
      return;
    }
    if (text === "/autoapply" || text.startsWith("/autoapply ")) {
      const arg = text.slice(11).trim().toLowerCase();
      if (!arg || arg === "status") {
        setMessages((old) => [...old, { role: "assistant", content: `Auto-apply: ${autoApply}. Build mode: ${mode()}. ${autoApply === "auto" ? "File proposals will be applied automatically." : "File proposals require manual /apply."}` }]);
        return;
      }
      if (arg === "on") {
        autoApply = "auto";
        setMessages((old) => [...old, { role: "assistant", content: "Auto-apply enabled. File proposals will be applied automatically in Build mode." }]);
        setNotice("auto-apply: on");
        return;
      }
      if (arg === "off") {
        autoApply = "manual";
        setMessages((old) => [...old, { role: "assistant", content: "Auto-apply disabled. File proposals require manual /apply." }]);
        setNotice("auto-apply: off");
        return;
      }
      if (arg === "save") {
        try {
          updateDotEnvAutoApply(autoApply);
          setMessages((old) => [...old, { role: "assistant", content: `Auto-apply setting saved to .env: ${autoApply}` }]);
        } catch (e) {
          setMessages((old) => [...old, { role: "assistant", content: `Failed to save: ${e instanceof Error ? e.message : String(e)}` }]);
        }
        return;
      }
      setMessages((old) => [...old, { role: "assistant", content: "Usage: /autoapply [on|off|status|save]" }]);
      return;
    }
    if (text.startsWith("/propose ")) {
      if (!workspaceTools) {
        setMessages((old) => [...old, { role: "assistant", content: "Workspace is not ready." }]);
        return;
      }
      if (pendingProposalId || awaitingWritePath !== undefined) {
        setMessages((old) => [...old, { role: "assistant", content: "Finish the current proposal with /apply or /reject before starting another." }]);
        return;
      }
      const target = text.slice(9).trim();
      if (!target) {
        setMessages((old) => [...old, { role: "assistant", content: "Usage: /propose <relative-path>" }]);
        return;
      }
      awaitingWritePath = target;
      setNotice(`waiting for replacement content for ${target}`);
      setMessages((old) => [...old, { role: "assistant", content: `Send the complete new contents for ${target} in your next message. Use Shift+Enter for multiple lines. Nothing will be written until you review the diff and type /apply. Type /cancel-write to cancel.` }]);
      return;
    }
    if (text === "/new") {
      startNewSession();
      return;
    }
    if (text === "/connect") {
      openConnectPopup();
      return;
    }
    if (text === "/session" || text.startsWith("/session ") || text === "/sessions" || text.startsWith("/sessions ")) {
      await handleSessionCommand(text.replace(/^\/sessions/, "/session"));
      return;
    }
    if (text === "/workspace") {
      setMessages((old) => [...old, { role: "assistant", content: workspaceTools
        ? `Workspace root:\n${workspaceTools.root}\n\nRead-only tools are limited to this directory.`
        : "Workspace is still initializing or could not be opened." }]);
      return;
    }
    if (text === "/ls" || text.startsWith("/ls ")) {
      const result = workspaceTools
        ? await workspaceTools.list(text.slice(3).trim() || ".")
        : { ok: false as const, error: "Workspace is not ready." };
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Tool error: ${result.error}` }]);
      return;
    }
    if (text === "/read" || text.startsWith("/read ")) {
      const result = workspaceTools
        ? await workspaceTools.read(text.slice(5).trim())
        : { ok: false as const, error: "Workspace is not ready." };
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Tool error: ${result.error}` }]);
      return;
    }
    if (text === "/search" || text.startsWith("/search ")) {
      const result = workspaceTools
        ? await workspaceTools.search(text.slice(7).trim())
        : { ok: false as const, error: "Workspace is not ready." };
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Tool error: ${result.error}` }]);
      return;
    }
    if (text === "/project") {
      const result = workspaceTools ? await workspaceTools.projectContext() : { ok: false as const, error: "Workspace is not ready." };
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : result.error }]);
      return;
    }
    if (text.startsWith("/command ")) {
      if (pendingCommandId) {
        setMessages((old) => [...old, { role: "assistant", content: "A command is already awaiting approval. Type /run to execute it once or /reject-command to discard it first." }]);
        return;
      }
      if (!terminalTools) {
        setMessages((old) => [...old, { role: "assistant", content: "Workspace/terminal is not ready." }]);
        return;
      }
      const result = await terminalTools.propose(text.slice(9).trim());
      if (!result.ok) {
        setMessages((old) => [...old, { role: "assistant", content: `Command not proposed: ${result.error}` }]);
        return;
      }
      pendingCommandId = result.proposal.id;
      setMessages((old) => [...old, { role: "assistant", content: `COMMAND PREVIEW — NOT EXECUTED\nID: ${result.proposal.id}\nCommand: ${result.proposal.command}\nWorking directory: ${result.proposal.cwd}\nTimeout: ${result.proposal.timeoutMs} ms\n\nInspect the exact command. Type /run to approve once, or /reject-command to discard.` }]);
      setNotice(`command ${result.proposal.id} awaiting approval`);
      return;
    }
    if (text === "/run") {
      if (!terminalTools || !pendingCommandId) {
        setMessages((old) => [...old, { role: "assistant", content: "No pending command. Preview one with /command first." }]);
        return;
      }
      const id = pendingCommandId;
      pendingCommandId = undefined;
      setBusy(true);
      setNotice("running approved command…");
      const result = await terminalTools.runApproved(id);
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Command failed: ${result.error}` }]);
      lastApproval = { kind: "command", id, status: result.ok ? "completed" : "failed" };
      setNotice(result.ok ? "command completed" : "command failed");
      setCatMood(result.ok ? "zoomies" : "error");
      setBusy(false);
      return;
    }
    if (text === "/reject-command") {
      const id = pendingCommandId;
      if (id && terminalTools) terminalTools.reject(id);
      pendingCommandId = undefined;
      lastApproval = { kind: "command", id: id ?? "", status: "rejected" };
      setMessages((old) => [...old, { role: "assistant", content: "Pending command discarded. Nothing was executed." }]);
      setNotice("command rejected");
      return;
    }
    if (text === "/capabilities") {
      const capabilities = getCapabilities(Boolean(workspaceTools));
      const listing = capabilities.map((item) => `${item.available ? "[available]" : "[unavailable]"} ${item.id} — ${item.description}`).join("\n");
      setMessages((old) => [...old, { role: "assistant", content: `MINT harness capabilities\nWorkspace: ${workspaceTools?.root ?? "not ready"}\n\n${listing}\n\n${formatAgentLimits(agentLimits)}` }]);
      return;
    }
    if (text === "/limits") {
      setMessages((old) => [...old, { role: "assistant", content: `${formatAgentLimits(agentLimits)}\nAuto-apply: ${autoApply} (${mode() === "build" ? "active" : "inactive in plan mode"})` }]);
      return;
    }
    if (text === "/help") {
      setMessages((old) => [...old, {
        role: "assistant",
        content: "Commands: /help · /cat · /pet · /feed · /expressions · /expression <id> · /models · /model · /connect · /session · /session new · /session delete <id> · /session rename · /workspace · /project · /capabilities · /limits · /autoapply [on|off|status|save] · /ls [path] · /read <path> · /search <text> · /propose <path> · /apply · /approve · /reject · /command <program args> · /run · /reject-command · /cancel · /clear · /quit\n\nShortcuts: Ctrl+Y = approve pending proposal/command\nFile changes require explicit /apply approval (or enable auto-apply with /autoapply on). Terminal commands are restricted, previewed, and run only after explicit /run approval. Web browsing remains unavailable.",
      }]);
      return;
    }
    if (text === "/models" || text === "/model") {
      openModelPicker(text === "/models");
      return;
    }
    if (text.startsWith("/model ")) {
      const requested = text.slice(7).trim();
      if (!isValidModelId(requested)) {
        setMessages((old) => [...old, { role: "assistant", content: "Invalid model ID." }]);
        return;
      }
      const found = models().find((entry) => entry.id === requested);
      if (found) {
        await applyModel(found.id);
      } else {
        setMessages((old) => [...old, { role: "assistant", content: `I can't find that model in the current NVIDIA catalog. Try /model to open the picker.` }]);
      }
      return;
    }
    if (text === "/clear") {
      startNewSession();
      return;
    }

    // Slash-prefixed input belongs to the harness, never to the model.
    // Unknown commands and malformed command arguments are rejected locally.
    if (text.startsWith("/")) {
      setNotice(`unknown or incomplete command: ${text.split(/\s+/)[0]} · type /help`);
      return;
    }

    if (!client || !model()) {
      setMessages((old) => [...old, { role: "user", content: text }, {
        role: "assistant",
        content: "I'm not connected yet. Check NVIDIA_API_KEY in your .env, then restart MINT.",
      }]);
      return;
    }

    lastUserPrompt = text;
    setMessages((old) => [...old, { role: "user", content: text }, { role: "assistant", content: "" }]);
    beginStreaming();
    persist({ role: "user", content: text });
    const updatedHistory: ChatMessage[] = [systemMessage(), ...history().filter((message) => message.role !== "system"), { role: "user", content: text }];
    setHistory(updatedHistory);
    setBusy(true);
    setModeLocked(true);
    setCatMood("thinking");
    activeController = new AbortController();
    setNotice(`thinking with ${model()}…`);

    try {
      let workingHistory = [...updatedHistory];
      let answer = "";
      let completed = false;
      const budget = new AgentTurnBudget(agentLimits);
      const repeatedCallGuard = new RepeatedCallGuard();
      while (budget.startRound()) {
        answer = "";
        setMessages((old) => {
          const next = [...old];
          const last = next[next.length - 1];
          if (!(last?.role === "assistant" && !last.kind)) next.push({ role: "assistant", content: "" });
          return next;
        });
        beginStreaming();
        let requestedCalls: ToolCall[] = [];
        let roundUsage: TokenUsage | null = null;
        const registeredTools = getModelTools(Boolean(workspaceTools), mode());
        for await (const event of client.streamAgent(model(), workingHistory, registeredTools, activeController.signal)) {
          if (event.type === "content") {
            answer += event.content;
            setStreamingContent(answer);
          } else if (event.type === "usage") {
            roundUsage = event.usage;
          } else {
            requestedCalls = event.toolCalls;
          }
        }
        if (roundUsage) {
          const usage = roundUsage;
          setSessionTokens((prev) => addTokenUsage(prev, usage));
          const sid = session();
          if (sid) store.addSessionTokenUsage(sid, usage);
        }

        if (!requestedCalls.length) {
          commitStreamingAnswer(answer);
          completed = true;
          break;
        }
        if (requestedCalls.some((call) => !call.id || !call.function?.name)) {
          throw new Error("The model returned an incomplete tool call (missing call ID or function name). Please retry or choose a model with tool-calling support.");
        }
        if (!budget.canAcceptCalls(requestedCalls.length)) {
          answer = formatLimitMessage("calls", budget, `The model requested ${requestedCalls.length} more call(s), but they were not executed because they would exceed the limit.`);
          break;
        }
        budget.recordCalls(requestedCalls.length);

        // Keep tool calls inside the current API turn. They are not displayed as final answers.
        workingHistory.push({ role: "assistant", content: answer || null, tool_calls: requestedCalls });
        answer = "";
        // Surface a timeline entry per tool call instead of a single placeholder.
        cancelStreamingPreview();
        setMessages((old) => {
          const next = [...old];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.kind) next[next.length - 1] = { ...last, content: "" };
          return next;
        });
        for (const call of requestedCalls) {
          setNotice(`running ${call.function.name}…`);
          // Tool call timeline line
          const args = formatToolArgs(call.function.arguments ?? "");
          setMessages((old) => [...old, { role: "assistant", content: "", kind: "tool", meta: { name: call.function.name, args } }]);
          const result = pendingProposalId && ["workspace_propose_write", "workspace_propose_patch"].includes(call.function.name)
            ? { ok: false as const, error: "A file proposal is already pending. Ask the user to /apply or /reject it before creating another." }
            : pendingCommandId && call.function.name === "terminal_propose"
              ? { ok: false as const, error: "A terminal command is already awaiting user approval. Ask the user to /run or /reject-command before proposing another." }
              : await executeModelTool(
              call.function.name,
              call.function.arguments,
              workspaceTools,
              (id) => { pendingProposalId = id; lastApproval = undefined; },
              terminalTools,
              (id) => { pendingCommandId = id; lastApproval = undefined; },
              mode(),
            );
          let toolOutput = result.ok ? result.output : `Tool failed: ${result.error}`;
          if (repeatedCallGuard.observe(call.function.name, call.function.arguments, toolOutput)) {
            toolOutput = "Repeated tool call detected: the arguments and result have remained identical for multiple attempts. Use the prior result or change the operation instead of looping.";
          }
          workingHistory.push({ role: "tool", tool_call_id: call.id, content: toolOutput });
          // Result timeline line
          const firstLine = toolOutput.split("\n")[0]?.slice(0, 120) ?? "";
          setMessages((old) => [...old, { role: "assistant", content: firstLine, kind: "result" }]);
          if (result.ok && ["workspace_propose_write", "workspace_propose_patch"].includes(call.function.name) && result.proposal) {
            const p = result.proposal;
            setMessages((old) => [...old, {
              role: "assistant",
              content: p.preview,
              kind: "proposal",
              meta: {
                id: p.id,
                path: p.path,
                tool: call.function.name,
                status: "awaiting approval",
                additions: String(p.additions ?? 0),
                deletions: String(p.deletions ?? 0),
                totalLines: String(p.totalLines ?? 0),
              },
            }]);
            
            // Auto-apply if enabled and in build mode
            if (autoApply === "auto" && mode() === "build" && workspaceTools) {
              const applyResult = await workspaceTools.applyWrite(p.id);
              if (applyResult.ok) {
                pendingProposalId = undefined;
                lastApproval = { kind: "file", id: p.id, status: "applied", automatic: true };
                // Update proposal card status
                setMessages((old) => old.map((m) => (m.meta?.id === p.id ? { ...m, meta: { ...m.meta, status: "applied automatically" } } : m)));
                // Replace tool output with auto-applied message
                toolOutput = `PROPOSAL AUTO-APPLIED — ${applyResult.output}`;
              } else {
                // Auto-apply failed, keep proposal pending
                setMessages((old) => old.map((m) => (m.meta?.id === p.id ? { ...m, meta: { ...m.meta, status: "auto-apply failed · awaiting approval" } } : m)));
                toolOutput = `Auto-apply failed: ${applyResult.error}. The proposal is still pending — use /apply to approve or /reject to discard.`;
              }
            }
          }
          if (result.ok && call.function.name === "terminal_propose") {
            setMessages((old) => [...old, { role: "assistant", content: "· awaiting /run", kind: "approval" }]);
          }
        }
      }
      if (!completed) {
        if (!answer.includes("limit reached:")) {
          const reached = budget.getLimitReached() ?? "rounds";
          answer = formatLimitMessage(reached, budget, "The requested task may still need implementation, verification, or error fixing.");
        }
        cancelStreamingPreview();
        setMessages((old) => {
          const next = [...old];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.kind) next[next.length - 1] = { ...last, content: answer };
          else next.push({ role: "assistant", content: answer });
          return next;
        });
      }
      if (answer) {
        setHistory([...updatedHistory, { role: "assistant", content: answer }]);
        persist({ role: "assistant", content: answer });
      }
      setNotice("ready ♡");
      setCatMood("happy");
    } catch (error) {
      cancelStreamingPreview();
      const aborted = activeController?.signal.aborted ?? false;
      const message = aborted ? "Request cancelled." : error instanceof Error ? error.message : "Unknown NVIDIA API error";
      setMessages((old) => {
        const next = [...old];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && !last.content) {
          next[next.length - 1] = { ...last, content: `Oops! ${message}` };
        } else {
          next.push({ role: "assistant", content: `Oops! ${message}` });
        }
        return next;
      });
      setNotice(aborted ? "cancelled" : "request failed");
      setCatMood(aborted ? "curious" : "error");
    } finally {
      activeController = undefined;
      setBusy(false);
       setModeLocked(false);
       cancelStreamingPreview();
    }
  };

  try {
    const config = loadConfig();
    client = new NvidiaClient(config.apiKey, config.baseUrl);
    configuredModel = config.preferredModel;
    agentLimits = { maxToolRounds: config.maxToolRounds, maxToolCallsPerTurn: config.maxToolCallsPerTurn };
    setModel(config.preferredModel);
    void refreshModels();
  } catch (error) {
    setStatus("error");
    setNotice(error instanceof Error ? error.message : "Configuration error");
  }

  const catAnimationTimer = setInterval(() => {
    if (catProfile().animationsEnabled) setCatFrame((frame) => (frame + 1) % 12);
  }, 500);
  onCleanup(() => clearInterval(catAnimationTimer));

  // Paste handler (terminal bracketed paste)
  usePaste((event) => {
    if (catMenuOpen() || sessionPickerOpen() || connectOpen()) return;
    pasteEventCounter++;
    const text = stripAnsiSequences(decodePasteBytes(event.bytes));
    const { text: sanitized, truncated } = sanitizePastedText(text);
    if (!sanitized) return;
    const { value: newValue, cursor: newCursor } = insertAtCursor(input(), cursorPos(), sanitized);
    setInput(newValue);
    setCursorPos(newCursor);
    if (truncated) showToast(`Paste truncated to ${MAX_PASTE_CHARS} chars`);
  });

  // Selection handler (mouse selection auto-copy)
  useSelectionHandler((selection) => {
    if (!selection || !selection.isActive) return;
    const selectedText = selection.getSelectedText();
    if (!selectedText || !selectedText.trim()) return;
    if (selectedText === lastAutoCopyText) return;
    lastAutoCopyText = selectedText;
    copyText(selectedText).then((ok) => {
      if (ok) showToast(`♡ copied ${selectedText.length} chars`);
    });
  });

  useKeyboard((key) => {
    const value = input();
    const pos = cursorPos();
    const suggestions = commandSuggestions();

    // Handle connect popup keys first
    if (connectOpen()) {
      void handleConnectKey(key);
      return;
    }

    // Handle model picker keys
    if (modelPickerOpen()) {
      if (handleModelPickerKey(key)) return;
    }

    // Handle rename popup keys
    if (renameOpen()) {
      if (handleRenameKey(key)) return;
    }

    // Global copy/paste shortcuts (work when not in popup)
    if (!connectOpen() && !sessionPickerOpen() && !catMenuOpen() && !modelPickerOpen() && !renameOpen()) {
      // Ctrl+Shift+V or Ctrl+V or Shift+Insert - paste from clipboard
      if ((key.ctrl && key.shift && key.name === "v") || (key.ctrl && key.name === "v") || (key.name === "insert" && key.shift)) {
        void readClipboardText().then((text) => {
          if (text) {
            const { text: sanitized, truncated } = sanitizePastedText(text);
            if (sanitized) {
              const { value: newValue, cursor: newCursor } = insertAtCursor(input(), cursorPos(), sanitized);
              setInput(newValue);
              setCursorPos(newCursor);
              if (truncated) showToast(`Paste truncated to ${MAX_PASTE_CHARS} chars`);
            }
          }
        });
        return;
      }
      // Ctrl+Shift+C - copy selection (or show nothing selected)
      if (key.ctrl && key.shift && key.name === "c") {
        if (renderer.hasSelection) {
          const selection = renderer.getSelection();
          const selectedText = selection?.getSelectedText() || "";
          if (selectedText) {
            void copyText(selectedText).then((ok) => {
              if (ok) showToast(`♡ copied ${selectedText.length} chars`);
              else showToast("Copy failed");
              renderer.clearSelection();
            });
          } else {
            showToast("Nothing selected");
          }
        } else {
          showToast("Nothing selected");
        }
        return;
      }
      // Ctrl+C - copy if selection exists, otherwise abort/exit
      if (key.ctrl && !key.shift && key.name === "c") {
        if (renderer.hasSelection) {
          const selection = renderer.getSelection();
          const selectedText = selection?.getSelectedText() || "";
          if (selectedText) {
            void copyText(selectedText).then((ok) => {
              if (ok) showToast(`♡ copied ${selectedText.length} chars`);
              else showToast("Copy failed");
              renderer.clearSelection();
            });
            return;
          }
        }
        if (activeController) {
          activeController.abort();
        } else {
          store.close();
          renderer.destroy();
        }
        return;
      }
      // Ctrl+Y - apply pending file proposal (when idle)
      if (key.ctrl && !key.shift && key.name === "y") {
        if (!busy() && !connectOpen() && !sessionPickerOpen() && !catMenuOpen() && !modelPickerOpen() && !renameOpen()) {
          void (async () => {
            if (pendingProposalId && workspaceTools) {
              const proposalId = pendingProposalId;
              const result = await workspaceTools.applyWrite(proposalId);
              if (result.ok) {
                pendingProposalId = undefined;
                lastApproval = { kind: "file", id: proposalId, status: "applied" };
                setMessages((old) => old.map((m) => (m.meta?.id === proposalId ? { ...m, meta: { ...m.meta, status: "applied" } } : m)));
                setMessages((old) => [...old, { role: "assistant", content: result.output }]);
                setCatMood("happy");
                setNotice("approved change applied (Ctrl+Y)");
              } else {
                setMessages((old) => [...old, { role: "assistant", content: `Change not applied: ${result.error}` }]);
                setCatMood("error");
                setNotice("approval failed");
              }
            } else if (pendingCommandId && terminalTools) {
              // For terminal commands, Ctrl+Y does /run
              const id = pendingCommandId;
              pendingCommandId = undefined;
              setBusy(true);
              setNotice("running approved command…");
              const result = await terminalTools.runApproved(id);
              setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Command failed: ${result.error}` }]);
              lastApproval = { kind: "command", id, status: result.ok ? "completed" : "failed" };
              setNotice(result.ok ? "command completed" : "command failed");
              setCatMood(result.ok ? "zoomies" : "error");
              setBusy(false);
            } else {
              showToast("No pending proposal or command to approve");
            }
          })();
        }
        return;
      }
    }

    if (sessionPickerOpen()) {
      const sessions = filteredSessions();
      const count = sessions.length;
      if (count === 0) { closeSessionPicker(); return; }
      let index = sessionPickerIndex();
      if (key.name === "escape") { closeSessionPicker(); return; }
      if (key.name === "up") { setSessionPickerIndex(movePickerIndex(index, -1, count)); return; }
      if (key.name === "down") { setSessionPickerIndex(movePickerIndex(index, 1, count)); return; }
      if (key.name === "pageup") { setSessionPickerIndex(pagePickerIndex(index, commandLimit(), count, -1)); return; }
      if (key.name === "pagedown") { setSessionPickerIndex(pagePickerIndex(index, commandLimit(), count, 1)); return; }
      if (key.name === "home") { setSessionPickerIndex(homeEndIndex(index, count, true)); return; }
      if (key.name === "end") { setSessionPickerIndex(homeEndIndex(index, count, false)); return; }
      if (key.name === "return") {
        const selected = sessions[sessionPickerIndex()];
        if (selected) { closeSessionPicker(); resumeSession(selected.id); }
        return;
      }
      if (key.name === "backspace") {
        setSessionPickerQuery((q) => q.slice(0, -1));
        setSessionPickerIndex(0);
        return;
      }
      if (key.ctrl && key.name === "u") {
        setSessionPickerQuery("");
        setSessionPickerIndex(0);
        return;
      }
      // Allow number keys 1-9 for direct selection
      const num = parseInt(key.sequence || "", 10);
      if (!isNaN(num) && num >= 1 && num <= count) { closeSessionPicker(); resumeSession(sessions[num - 1].id); return; }
      // Printable characters for filter
      if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
        setSessionPickerQuery((q) => q + key.sequence);
        setSessionPickerIndex(0);
        return;
      }
      return;
    }
    if (catMenuOpen()) {
      if (catExpressionPicker()) {
        if (key.name === "escape") { setCatExpressionPicker(false); return; }
        if (key.name === "up") { setCatExpressionIndex((old) => (old - 1 + CAT_EXPRESSIONS.length) % CAT_EXPRESSIONS.length); return; }
        if (key.name === "down") { setCatExpressionIndex((old) => (old + 1) % CAT_EXPRESSIONS.length); return; }
        if (key.name === "return") { equipCatExpression(CAT_EXPRESSIONS[catExpressionIndex()]?.id ?? "idle"); return; }
        return;
      }
      if (key.name === "escape") { setCatExpressionPicker(false); setCatMenuOpen(false); return; }
      if (key.name === "up") { setCatMenuIndex((old) => (old - 1 + catMenuItems.length) % catMenuItems.length); return; }
      if (key.name === "down") { setCatMenuIndex((old) => (old + 1) % catMenuItems.length); return; }
      if (key.name === "return") {
        const actionByIndex = ["pet", "feed", "expressions", "toggle-animations", "close"] as const;
        runCatAction(actionByIndex[catMenuIndex()] ?? "close");
        return;
      }
      if (key.sequence === "1") { runCatAction("pet"); return; }
      if (key.sequence === "2") { runCatAction("feed"); return; }
      if (key.sequence === "3") { runCatAction("expressions"); return; }
      if (key.sequence === "4") { runCatAction("toggle-animations"); return; }
      if (key.sequence === "5") { runCatAction("close"); return; }
      return;
    }
    if (key.name === "f2") { setCatMenuOpen(true); setCatMenuIndex(0); return; }
    if (key.shift && key.name === "tab") { toggleMode(); return; }
    if (key.name === "up" && suggestions.length) {
      setCommandIndex((old) => (old - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (key.name === "down" && suggestions.length) {
      setCommandIndex((old) => (old + 1) % suggestions.length);
      return;
    }
    if ((key.name === "tab" || key.name === "right") && suggestions.length && value.startsWith("/")) {
      const selected = suggestions[Math.min(commandIndex(), suggestions.length - 1)];
      if (selected) {
        const completed = selected.command.trimEnd();
        setInput(completed + (selected.command.endsWith(" ") ? " " : ""));
        setCursorPos((completed + (selected.command.endsWith(" ") ? " " : "")).length);
      }
      return;
    }
    if (key.name === "return" && key.shift) {
      if (!atMaxLines()) {
        setInput(value.slice(0, pos) + "\n" + value.slice(pos));
        setCursorPos(pos + 1);
      }
    } else if (key.name === "return") {
      const exactCommand = commands.find((item) => item.command.trim() === value.trim());
      const exactSuggestion = suggestions.find((item) => item.command.trim() === value.trim());
      // Argument-taking commands complete on first Enter; an exact model result can execute.
      if (suggestions.length && (Boolean(exactCommand?.command.endsWith(" ")) || (!exactSuggestion && !exactCommand))) {
        const selected = suggestions[Math.min(commandIndex(), suggestions.length - 1)];
        if (selected) {
          const nextValue = selected.command.endsWith(" ") ? selected.command : selected.command.trimEnd();
          setInput(nextValue);
          setCursorPos(nextValue.length);
        }
      } else void send();
    } else if (key.name === "backspace") {
      if (pos > 0) {
        setInput(value.slice(0, pos - 1) + value.slice(pos));
        setCursorPos(pos - 1);
      }
    } else if (key.name === "delete") {
      setInput(value.slice(0, pos) + value.slice(pos + 1));
    } else if (key.name === "left") {
      setCursorPos(Math.max(0, pos - 1));
    } else if (key.name === "right") {
      setCursorPos(Math.min(value.length, pos + 1));
    } else if (key.name === "home") {
      setCursorPos(0);
    } else if (key.name === "end") {
      setCursorPos(value.length);
    } else if (key.name === "escape") {
      setInput("");
      setCursorPos(0);
    } else if (
      key.sequence &&
      key.sequence.length > 0 &&
      !key.sequence.startsWith("\u001b") &&
      ((!key.ctrl) || key.sequence.length > 1)
    ) {
      // Bracketed paste can arrive as one multi-character sequence. Accept it
      // even if the terminal marks modifier flags on the event, while ignoring
      // single-character control shortcuts so Ctrl+Shift+C never enters input.
      const pasted = key.sequence.replace(/\r\n?/g, "\n");
      setCatMood("curious");
      setInput(value.slice(0, pos) + pasted + value.slice(pos));
      setCursorPos(pos + pasted.length);
    }
  });

  // Modal frame - full-screen backdrop with centered popup (wrapped in <Show> by caller)
  const ModalFrame = ({
    onClose,
    title,
    children,
    width = 80,
    minWidth = 40,
    borderColor = colors.lavender,
    topOffset = 2,
    leftOffset = 2,
    onMouseScroll,
  }: {
    onClose: () => void;
    title: string;
    children: JSX.Element;
    width?: number;
    minWidth?: number;
    borderColor?: string;
    topOffset?: number;
    leftOffset?: number;
    onMouseScroll?: (e: { scroll?: { direction: "up" | "down" | "left" | "right"; delta: number } }) => void;
  }) => {
    return (
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={100}
        onMouseDown={onClose}
      >
        <box
          position="absolute"
          top={Math.max(topOffset, Math.floor(terminal().height / 2) - Math.min(15, Math.floor((terminal().height - 8) / 2)))}
          left={Math.max(leftOffset, Math.floor((terminal().width - Math.min(width, terminal().width - 4)) / 2))}
          width={Math.min(width, terminal().width - 4)}
          minWidth={minWidth}
          backgroundColor={colors.panel}
          borderStyle="single"
          borderColor={borderColor}
          padding={1}
          gap={1}
          flexShrink={0}
          zIndex={101}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseScroll={onMouseScroll}
        >
          <box flexDirection="row" gap={1} width="100%" minWidth={0} overflow="hidden">
            <text fg={borderColor} wrapMode="none" flexShrink={1} truncate={true}>{title}</text>
          </box>
          {children}
        </box>
      </box>
    );
  };

  // Action button for modal footers
  const ActionButton = ({
    label,
    onClick,
    disabled = false,
    variant = "primary",
    width = "auto",
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: "primary" | "secondary" | "danger";
    width?: number | "auto" | `${number}%`;
  }) => (
    <box
      flexDirection="row"
      justifyContent="center"
      width={width}
      minWidth={0}
      height={1}
      minHeight={1}
      backgroundColor={disabled ? colors.muted : variant === "primary" ? colors.lavender : variant === "danger" ? colors.red : colors.panel}
      borderStyle={variant === "primary" ? undefined : "single"}
      borderColor={variant === "secondary" ? colors.muted : variant === "danger" ? colors.red : colors.lavender}
      paddingLeft={2}
      paddingRight={2}
      onMouseDown={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
    >
      <text
        fg={disabled ? colors.text : variant === "primary" ? colors.bg : colors.text}
        wrapMode="none"
        truncate={true}
      >
        {label}
      </text>
    </box>
  );

  // List row component for mouse-interactive lists
  const ListRow = <T,>({
    item,
    index,
    selectedIndex,
    onSelect,
    onClick,
    renderItem,
    hoverIndex,
    setHoverIndex,
    disabled = false,
  }: {
    item: T;
    index: number;
    selectedIndex: number;
    onSelect: (index: number) => void;
    onClick?: (item: T, index: number) => void;
    renderItem: (item: T, index: number, isSelected: boolean, isHovered: boolean) => JSX.Element;
    hoverIndex: number;
    setHoverIndex: (index: number) => void;
    disabled?: boolean;
  }) => {
    const isSelected = index === selectedIndex;
    const isHovered = index === hoverIndex;
    return (
      <box
        width="100%"
        minWidth={0}
        height={1}
        minHeight={1}
        overflow="hidden"
        backgroundColor={isSelected ? colors.lavender : isHovered ? colors.muted : colors.panel}
        onMouseMove={() => { if (!disabled) setHoverIndex(index); }}
        onMouseOut={() => { if (!disabled) setHoverIndex(-1); }}
        onMouseDown={(e) => { e.stopPropagation(); if (!disabled) onSelect(index); }}
        onMouseUp={(e) => { e.stopPropagation(); if (!disabled && onClick) onClick(item, index); }}
      >
        {renderItem(item, index, isSelected, isHovered)}
      </box>
    );
  };

  // Scroll helper for mouse wheel
  const handleWheel = (event: { scroll?: { direction: "up" | "down" | "left" | "right"; delta: number } }, setter: (delta: number) => void) => {
    if (event.scroll) {
      const delta = event.scroll.direction === "up" ? -event.scroll.delta : event.scroll.direction === "down" ? event.scroll.delta : 0;
      if (delta !== 0) setter(delta);
    }
  };

  return (
    <box flexDirection="column" backgroundColor={colors.bg} width="100%" height="100%">
      <box flexDirection="column" backgroundColor={colors.panel} width="100%" minWidth={0} flexShrink={0} overflow="hidden" border={["bottom"]} borderColor={colors.rule}>
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} width="100%" minWidth={0} overflow="hidden">
          <box flexDirection="row" gap={1} minWidth={0} flexShrink={1}>
            <Show when={terminal().width >= 52}>
              <ascii_font text="MINT" font="tiny" color={colors.pink} backgroundColor="transparent" selectable={false} />
            </Show>
            <Show when={terminal().width < 52}>
              <text fg={colors.pink} wrapMode="none" flexShrink={0}>✿ MINT</text>
            </Show>
            <Show when={terminal().width >= 72}>
              <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>/ tiny coding companion</text>
            </Show>
          </box>
          <box flexDirection="row" alignItems="center" justifyContent="flex-end" gap={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <box flexShrink={1} minWidth={0} overflow="hidden">
              <text fg={colors.lavender} wrapMode="none" width="100%">{getSessionTitle()}</text>
            </box>
            <text fg={colors.rule} wrapMode="none" flexShrink={0}>│</text>
            <text fg={statusColor()} wrapMode="none" flexShrink={0}>
              {terminal().width >= 56 ? `${statusGlyph()} ${statusLabel()}` : statusGlyph()}
            </text>
          </box>
        </box>
      </box>

      <box flexDirection="row" gap={1} flexGrow={1} minWidth={0} minHeight={0} width="100%" overflow="hidden">
        <Show when={sidebarVisible()}>
        <box flexDirection="column" backgroundColor={colors.panel} border={["right"]} borderColor={colors.rule} padding={1} width={sidebarMetrics().sidebarWidth} minWidth={scaledCells(28)} height="100%" minHeight={0} flexShrink={0} gap={0} overflow="hidden">
          <scrollbox flexGrow={1} minHeight={0} width="100%" overflow="hidden" verticalScrollbarOptions={{ visible: false }}>
            <box flexDirection="column" gap={1} width="100%" minWidth={0} flexShrink={0}>
              <box flexDirection="column" gap={0} flexShrink={0} onMouseDown={() => { setCatMenuOpen((open) => !open); setCatMenuIndex(0); setCatExpressionPicker(false); }}>
                <box borderStyle="single" borderColor={colors.rule} padding={1} alignSelf="center" overflow="hidden">
                  <CatPortrait
                    height={sidebarMetrics().catHeight}
                    expression={catProfile().selectedExpression as CatExpressionId}
                    mood={catMood()}
                    frame={catFrame()}
                    animated={catProfile().animationsEnabled}
                  />
                </box>
                <text fg={colors.pink} textAlign="center">MINT THE CAT</text>
                <text fg={colors.muted} textAlign="center">click or press F2 · /cat</text>
              </box>
              <text fg={colors.muted} width="100%" minWidth={0} flexShrink={0} wrapMode="none" truncate={true}>{catProfile().pets} pets · {catProfile().treats} treats</text>
              <box border={["bottom"]} borderColor={colors.rule} width="100%" height={1} minHeight={1} />
              <text fg={colors.lavender} width="100%" minWidth={0} wrapMode="none">SESSIONS</text>
              <For each={allSessions()}>
                {(s) => (
                  <box
                    flexDirection="column"
                    gap={0}
                    width="100%"
                    minWidth={0}
                    padding={1}
                    backgroundColor={session() === s.id ? colors.lavender : "transparent"}
                    onMouseUp={() => { if (session() !== s.id) resumeSession(s.id); }}
                  >
                    <text
                      fg={session() === s.id ? colors.bg : colors.text}
                      width="100%"
                      minWidth={0}
                      wrapMode="none"
                      truncate={true}
                    >
                      {s.title || "unnamed"}
                    </text>
                    <text
                      fg={session() === s.id ? colors.muted : colors.muted}
                      width="100%"
                      minWidth={0}
                      wrapMode="none"
                      truncate={true}
                    >
                      {displayModelName(s.model)} · {relativeTime(s.updated_at)}
                    </text>
                  </box>
                )}
              </For>
              <Show when={!session()}>
                <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none">draft · saved on first message</text>
              </Show>
            </box>
          </scrollbox>
        </box>
      </Show>

        <box flexGrow={1} minWidth={0} minHeight={0} width="100%" flexDirection="column" backgroundColor={colors.bg} paddingTop={1} paddingLeft={1} paddingRight={1} paddingBottom={0} gap={1} overflow="hidden">
          <box flexDirection="row" justifyContent="space-between" width="100%" minWidth={0} flexShrink={0} overflow="hidden" border={["bottom"]} borderColor={colors.rule}>
            <text fg={colors.lavender} wrapMode="none">✧ chat ✧</text>
            <Show when={!sidebarVisible()}>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={colors.pink} wrapMode="none">^.^</text>
                <text fg={colors.muted} wrapMode="none">{terminal().width >= 32 ? "F2 cat" : "F2"}</text>
              </box>
            </Show>
          </box>
          <scrollbox flexGrow={1} minHeight={0} minWidth={0} width="100%" contentOptions={{ flexDirection: "column", gap: 1 }} stickyScroll={true} stickyStart="bottom">
            <For each={messages()}>
              {(message, index) => {
                const isStreamingRow = () => streamingActive() && index() === messages().length - 1 && message.role === "assistant" && !message.kind;
                return (
                <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                  {message.kind === "tool" ? (
                    <box flexDirection="row" gap={1} width="100%" minWidth={0}>
                      <text fg={colors.peach} wrapMode="none" flexShrink={0}>·</text>
                      <text fg={colors.peach} wrapMode="none" flexShrink={0}>{message.meta?.name ?? ""}</text>
                      <Show when={message.meta?.args}>
                        <text fg={colors.lavender} wrapMode="none" flexGrow={1} minWidth={0} truncate={true}>{message.meta!.args}</text>
                      </Show>
                    </box>
                  ) : message.kind === "result" ? (
                    <box flexDirection="row" gap={1} width="100%" minWidth={0} paddingLeft={1}>
                      <text fg={colors.muted} wrapMode="none" flexShrink={0}>↳</text>
                      <text fg={colors.muted} wrapMode="none" flexGrow={1} minWidth={0} truncate={true}>{message.content}</text>
                    </box>
                  ) : message.kind === "proposal" ? (
                    <ProposalCard message={message} />
                  ) : message.kind === "approval" ? (
                    <box flexDirection="row" gap={1} width="100%" minWidth={0}>
                      <text fg={colors.peach} wrapMode="none" flexShrink={0}>·</text>
                      <text fg={colors.peach} wrapMode="none" flexGrow={1} minWidth={0} truncate={true}>{message.content}</text>
                    </box>
                  ) : message.kind === "mode" ? (
                    <box flexDirection="row" gap={1} width="100%" minWidth={0} paddingLeft={1} paddingRight={1}>
                      <text fg={message.meta?.mode === "plan" ? colors.pink : colors.mint} wrapMode="none" flexShrink={0}>●</text>
                      <text fg={message.meta?.mode === "plan" ? colors.pink : colors.mint} wrapMode="none" flexGrow={1} minWidth={0}>{message.content}</text>
                    </box>
                  ) : (
                    <>
                      <text fg={message.role === "user" ? colors.mint : message.role === "system" ? colors.muted : colors.pink}>
                        {message.role === "user" ? "you ❯" : "mint ♡ · answer"}
                      </text>
                      <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                        {isStreamingRow() ? (
                          <Show when={streamingContent()} fallback={<text fg={colors.peach} wrapMode="word" width="100%">Waiting for the response…</text>}>
                            <markdown content={streamingContent()} syntaxStyle={markdownStyle()} fg={colors.text} conceal={true} streaming={true} width="100%" minWidth={0} />
                          </Show>
                        ) : message.content
                          ? parseMessageSegments(message.content).map((seg) => renderSegment(seg, colors, markdownStyle()))
                          : busy()
                            ? <text fg={colors.peach} wrapMode="word" width="100%">Waiting for the response…</text>
                            : null
                        }
                      </box>
                    </>
                  )}
                </box>
              );
            }}
          </For>
          </scrollbox>
          <Show when={commandSuggestions().length > 0 && !modelPickerOpen()}>
            <box backgroundColor={colors.bg} borderStyle="single" borderColor={colors.lavender} padding={1} flexDirection="column" gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden" onMouseScroll={(e) => { e.stopPropagation(); }}>
              <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
                <text fg={colors.lavender} wrapMode="none" width="100%" minWidth={0} truncate={true}>{commandPaletteHeader()}</text>
              </box>
              <For each={commandSuggestions()}>{(item, index) => {
                return (
                  <box
                    flexDirection="row"
                    width="100%"
                    minWidth={0}
                    height={1}
                    minHeight={1}
                    overflow="hidden"
                    backgroundColor={index() === commandIndex() ? colors.lavender : colors.bg}
                    onMouseMove={() => { setCommandIndex(index()); }}
                    onMouseUp={(e) => { e.stopPropagation(); const value = input(); const selected = commandSuggestions()[index()]; if (selected) { const completed = selected.command.trimEnd(); const nextValue = completed + (selected.command.endsWith(" ") ? " " : ""); setInput(nextValue); setCursorPos(nextValue.length); if (selected.command.trim() === value.trim()) void send(); } }}
                  >
                    <text
                      fg={index() === commandIndex() ? colors.bg : colors.mint}
                      width={24}
                      maxWidth="100%"
                      minWidth={0}
                      flexShrink={1}
                      marginRight={1}
                      wrapMode="none"
                      truncate={true}
                    >
                      {(index() === commandIndex() ? "❯ " : "  ") + item.command.trimEnd()}
                    </text>
                    <Show when={terminal().width >= 72}>
                      <text
                        fg={index() === commandIndex() ? colors.bg : colors.muted}
                        flexGrow={1}
                        minWidth={0}
                        wrapMode="none"
                        truncate={true}
                      >
                        {item.description}
                      </text>
                    </Show>
                  </box>
                );
              }}</For>
            </box>
          </Show>
          <box flexDirection="column" gap={1} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
            <box backgroundColor={colors.panel} border={["top"]} borderColor={colors.rule} paddingLeft={1} paddingRight={1} paddingBottom={0} flexDirection="column" gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
              {inputLines() > 1 ? (
                <scrollbox height={Math.min(inputLines(), MAX_INPUT_LINES)} minHeight={1} width="100%" minWidth={0} overflow="hidden" stickyScroll={true} stickyStart="bottom">
                  <text fg={colors.mint} wrapMode="char" width="100%">❯ {input().slice(0, cursorPos())}<span style={{ fg: colors.bg, bg: colors.mint }}>{cursorGlyph()}</span>{input().slice(cursorPos() + cursorAdvance())}</text>
                </scrollbox>
              ) : (
                <text fg={colors.mint} width="100%" minWidth={0} wrapMode="char">❯ {input().slice(0, cursorPos())}<span style={{ fg: colors.bg, bg: colors.mint }}>{cursorGlyph()}</span>{input().slice(cursorPos() + cursorAdvance())}</text>
              )}
              <box height={1} minHeight={1} />
               <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>
                 <span style={{ fg: mode() === "plan" ? colors.pink : colors.mint }}>{mode() === "plan" ? "Plan" : "Build"}</span>
                 {terminal().width >= 60
                   ? ` · ${displayModelName(model() || configuredModel || "")} · ${effort()}`
                   : ` · ${effort()}`}
               </text>
            </box>
            <box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} width="100%" minWidth={0} flexShrink={0} overflow="hidden" paddingLeft={1} paddingRight={1}>
              <text fg={colors.muted} wrapMode="none" flexShrink={1} truncate={true}>{footerLabel()}</text>
              <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
                <Show when={showTokenUsage()}>
                  <text fg={colors.muted} wrapMode="none" flexShrink={0}>{tokenUsageLabel()}</text>
                </Show>
              </box>
            </box>
          </box>
        </box>
      </box>

      {/* Top-right toast notification */}
      <Show when={toast() !== null}>
        <box
          position="absolute"
          top={1}
          right={2}
          zIndex={50}
          backgroundColor={colors.panel}
          borderStyle="single"
          borderColor={colors.mint}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={(e) => { e.stopPropagation(); setToast(null); if (toastTimer) clearTimeout(toastTimer); }}
        >
          <text fg={colors.mint} wrapMode="none" truncate={true} width={scaledCells(40)}>{toast()}</text>
        </box>
      </Show>

      {/* Connect popup */}
      <Show when={connectOpen()}>
        <ModalFrame
          onClose={closeConnectPopup}
          title="✿ CONNECT NVIDIA"
          width={scaledCells(72)}
          minWidth={scaledCells(40)}
          borderColor={colors.pink}
        >
        <box flexDirection="column" gap={1} width="100%">
          <box flexDirection="row" gap={1} width="100%" minWidth={0}>
            <text fg={connectField() === "apiKey" ? colors.pink : colors.muted} wrapMode="none" width={8}>API KEY</text>
            <box
              flexGrow={1}
              minWidth={0}
              backgroundColor={colors.bg}
              borderStyle="single"
              borderColor={connectField() === "apiKey" ? colors.pink : colors.muted}
              paddingLeft={1}
              paddingRight={1}
              overflow="hidden"
              onMouseDown={(e) => { e.stopPropagation(); setConnectField("apiKey"); setConnectFieldCursor("apiKey", connectFieldValue("apiKey").length); }}
            >
              <text
                fg={colors.text}
                wrapMode="none"
                width="100%"
                minWidth={0}
                truncate={true}
              >
                {maskSecret(connectFieldValue("apiKey")).slice(Math.max(0, connectFieldCursor("apiKey") - 36))}▌
              </text>
            </box>
          </box>
          <box flexDirection="row" gap={1} width="100%" minWidth={0}>
            <text fg={connectField() === "baseUrl" ? colors.pink : colors.muted} wrapMode="none" width={8}>BASE URL</text>
            <box
              flexGrow={1}
              minWidth={0}
              backgroundColor={colors.bg}
              borderStyle="single"
              borderColor={connectField() === "baseUrl" ? colors.pink : colors.muted}
              paddingLeft={1}
              paddingRight={1}
              overflow="hidden"
              onMouseDown={(e) => { e.stopPropagation(); setConnectField("baseUrl"); setConnectFieldCursor("baseUrl", connectFieldValue("baseUrl").length); }}
            >
              <text
                fg={colors.text}
                wrapMode="none"
                width="100%"
                minWidth={0}
                truncate={true}
              >
                {connectFieldValue("baseUrl").slice(Math.max(0, connectFieldCursor("baseUrl") - 36))}▌
              </text>
            </box>
          </box>
          <box flexDirection="row" gap={1} width="100%" minWidth={0}>
            <text fg={connectField() === "model" ? colors.pink : colors.muted} wrapMode="none" width={8}>MODEL</text>
            <box
              flexGrow={1}
              minWidth={0}
              backgroundColor={colors.bg}
              borderStyle="single"
              borderColor={connectField() === "model" ? colors.pink : colors.muted}
              paddingLeft={1}
              paddingRight={1}
              overflow="hidden"
              onMouseDown={(e) => { e.stopPropagation(); setConnectField("model"); setConnectFieldCursor("model", connectFieldValue("model").length); }}
            >
              <text
                fg={colors.text}
                wrapMode="none"
                width="100%"
                minWidth={0}
                truncate={true}
              >
                {connectFieldValue("model").slice(Math.max(0, connectFieldCursor("model") - 36))}▌
              </text>
            </box>
          </box>
        </box>
        <Show when={connectError()}>
          <text fg={colors.red} wrapMode="none" width="100%" minWidth={0} truncate={true}>{connectError()}</text>
        </Show>
        <Show when={connectBusy()}>
          <text fg={colors.peach} wrapMode="none" width="100%" minWidth={0} truncate={true}>· testing connection… (Esc to cancel)</text>
        </Show>
        <Show when={!connectBusy()}>
          <box flexDirection="row" gap={1} justifyContent="flex-end" width="100%">
            <ActionButton label="Cancel" onClick={closeConnectPopup} variant="secondary" />
            <ActionButton label="Connect" onClick={submitConnect} variant="primary" disabled={connectBusy()} />
          </box>
        </Show>
      </ModalFrame>
      </Show>

      {/* Model picker (inline, same slot as command palette) */}
      <Show when={modelPickerOpen()}>
        <box backgroundColor={colors.bg} borderStyle="single" borderColor={colors.lavender} padding={1} flexDirection="column" gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden" onMouseScroll={(e) => handleWheel(e, (d) => setModelPickerIndex(movePickerIndex(modelPickerIndex(), d, modelPickerSuggestions().length)))} >
          <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
            <text fg={colors.lavender} wrapMode="none" width="100%" minWidth={0} truncate={true}>{modelPickerHeader()}</text>
           <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
             <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>{`search: ${modelPickerQuery()}${modelPickerQuery() ? "" : " (type to filter)"}`}</text>
           </box>
          </box>
          <Show when={modelPickerError()}>
            <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
              <text fg={colors.red} wrapMode="none" width="100%" minWidth={0} truncate={true}>Error: {modelPickerError()}</text>
            </box>
          </Show>
          <Show when={modelPickerBusy()}>
            <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
              <text fg={colors.peach} wrapMode="none" width="100%" minWidth={0} truncate={true}>⟳ fetching models…</text>
            </box>
          </Show>
          <Show when={modelPickerSuggestions().length > 0 && !modelPickerBusy()}>
            <For each={visibleWindow(modelPickerIndex(), commandLimit(), modelPickerSuggestions().length)}>{(idx) => {
              const allModels = filterModels(mergeCurrentModel(models(), configuredModel || model() || ""), modelPickerQuery());
              const m = allModels[idx];
              if (!m) return <text> </text>;
              const isCurrent = m.id === (configuredModel || model());
              return (
                <box
                  flexDirection="row"
                  width="100%"
                  minWidth={0}
                  height={1}
                  minHeight={1}
                  overflow="hidden"
                  backgroundColor={idx === modelPickerIndex() ? colors.lavender : colors.bg}
                  onMouseMove={() => { setModelPickerIndex(idx); }}
                  onMouseUp={(e) => { e.stopPropagation(); void applyModel(m.id); }}
                >
                  <text
                    fg={idx === modelPickerIndex() ? colors.bg : isCurrent ? colors.mint : colors.text}
                    width={terminal().width >= 80 ? 48 : terminal().width >= 60 ? 36 : 28}
                    maxWidth="100%"
                    minWidth={0}
                    flexShrink={1}
                    marginRight={1}
                    wrapMode="none"
                    truncate={true}
                  >
                    {(idx === modelPickerIndex() ? "❯ " : "  ") + m.id + (isCurrent ? " ●" : "")}
                  </text>
                  <Show when={terminal().width >= 72 && m.owned_by}>
                    <text
                      fg={idx === modelPickerIndex() ? colors.bg : colors.muted}
                      flexGrow={1}
                      minWidth={0}
                      wrapMode="none"
                      truncate={true}
                    >
                      {m.owned_by}
                    </text>
                  </Show>
                </box>
              );
            }}</For>
          </Show>
          <Show when={modelPickerSuggestions().length === 0 && !modelPickerBusy() && !modelPickerError()}>
            <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
              <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>No models match "{modelPickerQuery()}". Press Ctrl+R to refresh catalog.</text>
            </box>
          </Show>
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>↑/↓ · PgUp/PgDn · Home/End · type filter · Enter use · Esc close · Ctrl+R refresh · Ctrl+U clear</text>
        </box>
      </Show>

      {/* Rename popup */}
      <Show when={renameOpen()}>
        <ModalFrame
          onClose={closeRenamePopup}
          title="✎ RENAME SESSION"
          width={scaledCells(60)}
          minWidth={scaledCells(30)}
          borderColor={colors.pink}
        >
        <box flexDirection="row" gap={1} width="100%" minWidth={0}>
          <text fg={colors.muted} wrapMode="none" width={5}>name</text>
          <box
            flexGrow={1}
            minWidth={0}
            backgroundColor={colors.bg}
            borderStyle="single"
            borderColor={colors.pink}
            paddingLeft={1}
            paddingRight={1}
            overflow="hidden"
          >
            <text
              fg={colors.text}
              wrapMode="none"
              width="100%"
              minWidth={0}
              truncate={true}
            >
              {renameDraft()}▌
            </text>
          </box>
        </box>
        <Show when={renameError()}>
          <text fg={colors.red} wrapMode="none" width="100%" minWidth={0} truncate={true}>{renameError()}</text>
        </Show>
        <box flexDirection="row" gap={1} justifyContent="flex-end" width="100%">
          <ActionButton label="Cancel" onClick={closeRenamePopup} variant="secondary" />
          <ActionButton label="Save" onClick={applyRename} variant="primary" />
        </box>
        <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>Enter save · Esc cancel · Ctrl+Shift+V paste</text>
      </ModalFrame>
    </Show>

      {/* Session picker modal */}
      <Show when={sessionPickerOpen()}>
        <ModalFrame
          onClose={closeSessionPicker}
          title={`✧ SESSIONS · ${filteredSessions().length}${sessionPickerQuery() ? ` · filter "${sessionPickerQuery()}"▌` : ""}`}
          width={scaledCells(80)}
          minWidth={scaledCells(50)}
          borderColor={colors.lavender}
          onMouseScroll={(e) => handleWheel(e, (d) => setSessionPickerIndex(movePickerIndex(sessionPickerIndex(), d, filteredSessions().length)))}
        >
          <Show when={filteredSessions().length === 0}>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>No saved sessions yet.</text>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>Send a message to create your first session.</text>
          </Show>
          <Show when={filteredSessions().length > 0}>
            <For each={visibleWindow(sessionPickerIndex(), commandLimit(), filteredSessions().length)}>{(idx) => {
              const s = filteredSessions()[idx];
              return (
                <box
                  flexDirection="row"
                  width="100%"
                  minWidth={0}
                  height={1}
                  minHeight={1}
                  overflow="hidden"
                  backgroundColor={idx === sessionPickerIndex() ? colors.lavender : colors.panel}
                  onMouseMove={(e) => { e.stopPropagation(); setSessionPickerIndex(idx); }}
                  onMouseUp={(e) => { e.stopPropagation(); closeSessionPicker(); resumeSession(s.id); }}
                >
                  <text
                    fg={idx === sessionPickerIndex() ? colors.bg : colors.text}
                    wrapMode="none"
                    width="100%"
                    minWidth={0}
                    truncate={true}
                  >
                    {(idx === sessionPickerIndex() ? "❯ " : "  ") + (s.title || "unnamed") + "  " + (s.model ? "[" + s.model + "]" : "[no model]") + "  #" + s.id}
                  </text>
                </box>
              );
            }}</For>
          </Show>
          <box flexDirection="row" gap={1} justifyContent="space-between" width="100%">
            <ActionButton label="New Session" onClick={() => { closeSessionPicker(); startNewSession(); }} variant="primary" />
            <ActionButton label="Close" onClick={closeSessionPicker} variant="secondary" />
          </box>
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>↑/↓ move · PgUp/PgDn · Home/End · type filter · 1-9 select · Enter resume · Esc close · Ctrl+U clear</text>
        </ModalFrame>
      </Show>

      {/* Cat menu modal */}
      <Show when={catMenuOpen()}>
        <ModalFrame
          onClose={() => { setCatMenuOpen(false); setCatExpressionPicker(false); }}
          title="FELIS TERMINALIS"
          width={terminal().width >= 80 ? 76 : 56}
          minWidth={36}
          borderColor={colors.rule}
        >
        <box flexDirection={terminal().width >= 80 ? "row" : "column"} gap={2} width="100%" minWidth={0} alignItems={terminal().width >= 80 ? "flex-start" : "center"}>
          <box borderStyle="single" borderColor={colors.rule} padding={0} overflow="hidden">
            <CatPortrait
              height={terminal().width >= 80 ? Math.min(24, terminal().height - 8) : 18}
              expression={catProfile().selectedExpression as CatExpressionId}
              mood={catMood()}
              frame={catFrame()}
              animated={catProfile().animationsEnabled}
            />
          </box>
          <box flexDirection="column" gap={1} width="100%" minWidth={0} flexGrow={1}>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true} textAlign={terminal().width >= 80 ? "left" : "center"}>{catProfile().pets} pets · {catProfile().treats} treats</text>
            <Show when={catExpressionPicker()}>
              <text fg={colors.pink}>--- EXPRESSIONS ---</text>
              <For each={CAT_EXPRESSIONS}>{(expression, index) =>
                <box
                  flexDirection="row"
                  width="100%"
                  minWidth={0}
                  height={1}
                  minHeight={1}
                  overflow="hidden"
                  backgroundColor={index() === catExpressionIndex() ? colors.lavender : colors.panel}
                  onMouseMove={() => { setCatExpressionIndex(index()); }}
                  onMouseUp={(e) => { e.stopPropagation(); if (catProfile().unlockedExpressions.includes(expression.id)) equipCatExpression(expression.id); }}
                >
                  <text
                    fg={index() === catExpressionIndex() ? colors.bg : catProfile().unlockedExpressions.includes(expression.id) ? colors.text : colors.muted}
                    wrapMode="none"
                    width="100%"
                    minWidth={0}
                    truncate={true}
                  >
                    {(index() === catExpressionIndex() ? "❯ " : "  ") + (catProfile().unlockedExpressions.includes(expression.id) ? "◆ " : "× ") + expression.label}
                  </text>
                </box>
              }</For>
              <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>↑/↓ choose · Enter · Esc · Click to equip</text>
            </Show>
            <Show when={!catExpressionPicker()}>
              <text fg={colors.pink}>--- CAT MENU ---</text>
              <For each={catMenuItems}>{(item, index) =>
                <box
                  flexDirection="row"
                  width="100%"
                  minWidth={0}
                  height={1}
                  minHeight={1}
                  overflow="hidden"
                  backgroundColor={index() === catMenuIndex() ? colors.lavender : colors.panel}
                  onMouseMove={() => { setCatMenuIndex(index()); }}
                  onMouseUp={(e) => { e.stopPropagation(); const actionByIndex = ["pet", "feed", "expressions", "toggle-animations", "close"] as const; runCatAction(actionByIndex[index()] ?? "close"); }}
                >
                  <text
                    fg={index() === catMenuIndex() ? colors.bg : colors.text}
                    wrapMode="none"
                    width="100%"
                    minWidth={0}
                    truncate={true}
                  >
                    {(index() === catMenuIndex() ? "❯ " : "  ") + item.shortcut + "  " + item.label}
                  </text>
                </box>
              }</For>
              <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>{"· " + (catMenuItems[catMenuIndex()]?.detail ?? "")}</text>
              <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>↑/↓ + Enter · Esc close · Click to run</text>
            </Show>
          </box>
        </box>
      </ModalFrame>
    </Show>
    </box>
  );
}

// Keep Ctrl+C under the app's keyboard handler. OpenTUI's built-in shortcut
// exits before we can distinguish Ctrl+C from Ctrl+Shift+C (terminal copy).
await render(() => <App />, { exitOnCtrlC: false, targetFps: 30 });