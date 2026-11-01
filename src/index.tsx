import { render, useKeyboard, useRenderer, useTerminalDimensions, usePaste, useSelectionHandler } from "@opentui/solid";
import { For, Show, createMemo, createSignal, createEffect, onCleanup, onMount, JSX } from "solid-js";
import { loadConfig, writeDotEnv, updateDotEnvModel, type MintConfig } from "./config";
import { AgentTurnBudget, formatAgentLimits, formatLimitMessage, RepeatedCallGuard } from "./agent-loop";
import { NvidiaClient, type ChatMessage, type NvidiaModel, type ToolCall } from "./nvidia";
import { buildSystemPrompt, executeModelTool, getCapabilities, getModelTools } from "./agent-tools";
import { SessionStore, type StoredMessage, type Session } from "./storage";
import { WorkspaceTools } from "./tools";
import { ApprovedTerminal } from "./terminal";
import { CAT_EXPRESSIONS, catProfileSummary, feedCat, petCat, selectCatExpression, type CatMood, type CatExpressionId } from "./cat";
import { CatPortrait, RunCatIndicator } from "./cat-portrait";
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
import { createHostClipboard, createClipboard, createRendererClipboardAdapter, decodePasteBytes, stripAnsiSequences } from "@opentui/core";

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
};

type ViewMessage = { role: "user" | "assistant" | "system"; content: string };

type MessageSegment =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "diff"; language: string; content: string; hunks: DiffHunk[] };

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

// Parse assistant message into structured segments for rich rendering
function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let remaining = content;

  // Regex to match fenced code blocks with optional diff language
  const codeBlockRegex = /^```(\w+)?\n([\s\S]*?)\n```/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(remaining)) !== null) {
    const [fullMatch, language = "", codeContent] = match;
    const matchStart = match.index;
    const matchEnd = match.index + fullMatch.length;

    // Text before this code block
    if (matchStart > lastIndex) {
      const textContent = remaining.slice(lastIndex, matchStart).trimEnd();
      if (textContent) {
        // Check for reasoning blocks in text
        const reasoningParts = splitReasoning(textContent);
        segments.push(...reasoningParts);
      }
    }

    // Check if this is a diff block
    if (language.toLowerCase() === "diff") {
      const diffSegments = parseDiffBlock(codeContent);
      segments.push(...diffSegments);
    } else {
      segments.push({ type: "code", language, content: codeContent });
    }

    lastIndex = matchEnd;
  }

  // Remaining text after last code block
  if (lastIndex < remaining.length) {
    const textContent = remaining.slice(lastIndex).trimEnd();
    if (textContent) {
      const reasoningParts = splitReasoning(textContent);
      segments.push(...reasoningParts);
    }
  }

  // If no segments found, treat entire content as text
  if (segments.length === 0) {
    const reasoningParts = splitReasoning(content);
    segments.push(...reasoningParts);
  }

  return segments;
}

// Split text into reasoning and regular text segments
function splitReasoning(text: string): MessageSegment[] {
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
    if (textContent.trim()) {
      segments.push({ type: "text", content: textContent });
    }
  }

  if (segments.length === 0 && text.trim()) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

// Parse a diff block into structured diff segments
function parseDiffBlock(diffContent: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  // Match unified diff format: @@ -oldStart,oldLines +newStart,newLines @@
  const hunkRegex = /^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const hunks: DiffHunk[] = [];

  while ((match = hunkRegex.exec(diffContent)) !== null) {
    const oldStart = parseInt(match[1], 10);
    const oldLines = match[2] ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newLines = match[4] ? parseInt(match[4], 10) : 1;
    const hunkStart = match.index;
    const hunkEnd = hunkRegex.lastIndex;

    // Extract lines for this hunk (until next hunk or end)
    const nextMatch = hunkRegex.exec(diffContent);
    const hunkContentEnd = nextMatch ? nextMatch.index : diffContent.length;
    if (nextMatch) hunkRegex.lastIndex = nextMatch.index; // reset for next iteration

    const hunkLinesContent = diffContent.slice(hunkEnd, hunkContentEnd).trimEnd();
    const lines = parseDiffLines(hunkLinesContent, oldStart, newStart);

    hunks.push({ oldStart, oldLines, newStart, newLines, lines });
  }

  if (hunks.length > 0) {
    segments.push({ type: "diff", language: "diff", content: diffContent, hunks });
  } else {
    // Fallback: treat as regular code block
    segments.push({ type: "code", language: "diff", content: diffContent });
  }

  return segments;
}

// Parse individual diff lines within a hunk
function parseDiffLines(content: string, oldStart: number, newStart: number): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLineNum = oldStart;
  let newLineNum = newStart;

  for (const line of content.split("\n")) {
    if (line.startsWith("+")) {
      lines.push({ type: "add", content: line.slice(1), newLineNum: newLineNum++ });
    } else if (line.startsWith("-")) {
      lines.push({ type: "remove", content: line.slice(1), oldLineNum: oldLineNum++ });
    } else {
      lines.push({ type: "context", content: line.slice(1), oldLineNum: oldLineNum++, newLineNum: newLineNum++ });
    }
  }

  return lines;
}

// Render a single message segment into JSX
function renderSegment(segment: MessageSegment, colors: typeof colors): JSX.Element {
  switch (segment.type) {
    case "text":
      return (
        <text fg={colors.text} wrapMode="word" width="100%" minWidth={0}>
          {segment.content}
        </text>
      );
    case "reasoning":
      return (
        <box flexDirection="column" gap={0} width="100%" minWidth={0} backgroundColor={colors.bg} padding={1} borderStyle="single" borderColor={colors.muted}>
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>◆ reasoning</text>
          <text fg={colors.muted} wrapMode="word" width="100%" minWidth={0} opacity={0.8}>
            {segment.content}
          </text>
        </box>
      );
    case "code":
      return (
        <box flexDirection="column" gap={0} width="100%" minWidth={0} backgroundColor={colors.bg} padding={1} borderStyle="single" borderColor={colors.muted}>
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>
            {segment.language ? `◆ ${segment.language}` : "◆ code"}
          </text>
          <text fg={colors.text} wrapMode="none" width="100%" minWidth={0} fontFamily="monospace">
            {segment.content}
          </text>
        </box>
      );
    case "diff":
      return (
        <box flexDirection="column" gap={0} width="100%" minWidth={0} backgroundColor={colors.bg} padding={1} borderStyle="single" borderColor={colors.muted}>
          <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>◆ diff</text>
          <For each={segment.hunks}>
            {(hunk) => (
              <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true} fontFamily="monospace">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </text>
                <For each={hunk.lines}>
                  {(line) => (
                    <box
                      flexDirection="row"
                      width="100%"
                      minWidth={0}
                      height={1}
                      minHeight={1}
                      backgroundColor={
                        line.type === "add" ? "#1a3a2a" : // green/blue background for added
                        line.type === "remove" ? "#3a1a1a" : // red background for removed
                        colors.bg
                      }
                    >
                      <text
                        fg={line.type === "add" ? colors.mint : line.type === "remove" ? colors.red : colors.muted}
                        wrapMode="none"
                        width={4}
                        minWidth={4}
                        fontFamily="monospace"
                      >
                        {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                      </text>
                      <text
                        fg={line.type === "add" ? colors.mint : line.type === "remove" ? colors.red : colors.text}
                        wrapMode="none"
                        flexGrow={1}
                        minWidth={0}
                        fontFamily="monospace"
                      >
                        {line.content}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      );
  }
}

function App() {
  const [input, setInput] = createSignal("");
  const [cursorPos, setCursorPos] = createSignal(0);
  const [commandIndex, setCommandIndex] = createSignal(0);
  const renderer = useRenderer();
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
  const toggleMode = () => setMode((m) => (m === "plan" ? "build" : "plan"));
  const [models, setModels] = createSignal<NvidiaModel[]>([]);
  const [model, setModel] = createSignal("");
  const [status, setStatus] = createSignal("starting");
  const [busy, setBusy] = createSignal(false);
  const [runCatSpeed, setRunCatSpeed] = createSignal<"trot" | "run" | "sprint">("run");
  const [notice, setNotice] = createSignal("Connecting to NVIDIA…");
  let workspaceTools: WorkspaceTools | undefined;
  let terminalTools: ApprovedTerminal | undefined;
  let agentLimits = { maxToolRounds: 12, maxToolCallsPerTurn: 24 };
  const systemMessage = (): ChatMessage => ({ role: "system", content: buildSystemPrompt(Boolean(workspaceTools), workspaceTools?.root, agentLimits) });
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
  let pendingProposalId: string | undefined;
  let pendingCommandId: string | undefined;
  void WorkspaceTools.create().then((tools) => {
    workspaceTools = tools;
    terminalTools = new ApprovedTerminal(tools.root);
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
  let client: NvidiaClient | undefined;
  let configuredModel = "";
  let lastUserPrompt = "";
  let activeController: AbortController | undefined;
  const sidebarVisible = () => terminal().width >= 100;

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
  const chatWidth = () => Math.max(0, terminal().width - (sidebarVisible() ? 37 : 6));
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

  const getSessionTitle = () => {
    const sid = session();
    if (sid) {
      const s = store.getSession(sid);
      return s?.title || "unnamed";
    }
    return draftSessionTitle() || "new session";
  };

  const persist = (message: StoredMessage) => {
    const sid = session();
    if (sid) {
      store.addMessage(sid, message);
    } else {
      // First message - create session with the message
      const newSession = store.createSessionWithMessage(model(), message, draftSessionTitle() || undefined);
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
    if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
      setModelPickerQuery((q) => q + key.sequence);
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
    const sessions = store.listSessions();
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
      setMessages((old) => [...old, { role: "assistant", content: `PROPOSED CHANGE · ${result.proposal.path}
Proposal ID: ${result.proposal.id}

${result.proposal.preview}

No file has been changed. Review this preview, then type /apply to approve or /reject to discard it.` }]);
      setNotice(`review proposal ${result.proposal.id}`);
      return;
    }
    if (text === "/apply") {
      if (!workspaceTools || !pendingProposalId) {
        setMessages((old) => [...old, { role: "assistant", content: "There is no pending file change to apply." }]);
        return;
      }
      const result = await workspaceTools.applyWrite(pendingProposalId);
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : `Change not applied: ${result.error}` }]);
      if (result.ok) { pendingProposalId = undefined; setCatMood("happy"); }
      else setCatMood("error");
      setNotice(result.ok ? "approved change applied" : "approval failed");
      return;
    }
    if (text === "/reject") {
      if (!workspaceTools || !pendingProposalId) {
        setMessages((old) => [...old, { role: "assistant", content: "There is no pending file change to reject." }]);
        return;
      }
      const result = workspaceTools.rejectWrite(pendingProposalId);
      pendingProposalId = undefined;
      setMessages((old) => [...old, { role: "assistant", content: result.ok ? result.output : result.error }]);
      setNotice("proposal rejected");
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
      setNotice(result.ok ? "command completed" : "command failed");
      setCatMood(result.ok ? "zoomies" : "error");
      setBusy(false);
      return;
    }
    if (text === "/reject-command") {
      if (pendingCommandId && terminalTools) terminalTools.reject(pendingCommandId);
      pendingCommandId = undefined;
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
      setMessages((old) => [...old, { role: "assistant", content: formatAgentLimits(agentLimits) }]);
      return;
    }
    if (text === "/help") {
      setMessages((old) => [...old, {
        role: "assistant",
        content: "Commands: /help · /cat · /pet · /feed · /expressions · /expression <id> · /models · /model · /connect · /session · /session new · /session delete <id> · /session rename · /workspace · /project · /capabilities · /limits · /ls [path] · /read <path> · /search <text> · /propose <path> · /apply · /reject · /command <program args> · /run · /reject-command · /cancel · /clear · /quit\n\nFile changes require explicit /apply approval. Terminal commands are restricted, previewed, and run only after explicit /run approval. Web browsing remains unavailable.",
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
    persist({ role: "user", content: text });
    const updatedHistory: ChatMessage[] = [systemMessage(), ...history().filter((message) => message.role !== "system"), { role: "user", content: text }];
    setHistory(updatedHistory);
    setBusy(true);
    setRunCatSpeed("trot");
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
        let requestedCalls: ToolCall[] = [];
        const registeredTools = getModelTools(Boolean(workspaceTools));
        for await (const event of client.streamAgent(model(), workingHistory, registeredTools, activeController.signal)) {
          if (event.type === "content") {
            setRunCatSpeed("run");
            answer += event.content;
            setMessages((old) => {
              const next = [...old];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: answer };
              return next;
            });
          } else {
            requestedCalls = event.toolCalls;
          }
        }

        if (!requestedCalls.length) {
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
        setMessages((old) => {
          const next = [...old];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: "Using registered workspace tools…" };
          return next;
        });
        let proposalPreview: string | undefined;
        for (const call of requestedCalls) {
          setRunCatSpeed("sprint");
          setNotice(`running ${call.function.name}…`);
          const result = pendingProposalId && ["workspace_propose_write", "workspace_propose_patch"].includes(call.function.name)
            ? { ok: false as const, error: "A file proposal is already pending. Ask the user to /apply or /reject it before creating another." }
            : pendingCommandId && call.function.name === "terminal_propose"
              ? { ok: false as const, error: "A terminal command is already awaiting user approval. Ask the user to /run or /reject-command before proposing another." }
              : await executeModelTool(
              call.function.name,
              call.function.arguments,
              workspaceTools,
              (id) => { pendingProposalId = id; },
              terminalTools,
              (id) => { pendingCommandId = id; },
            );
          let toolOutput = result.ok ? result.output : `Tool failed: ${result.error}`;
          if (repeatedCallGuard.observe(call.function.name, call.function.arguments, toolOutput)) {
            toolOutput = "Repeated tool call detected: the arguments and result have remained identical for multiple attempts. Use the prior result or change the operation instead of looping.";
          }
          if (result.ok && ["workspace_propose_write", "workspace_propose_patch", "terminal_propose"].includes(call.function.name)) proposalPreview = result.output;
          workingHistory.push({ role: "tool", tool_call_id: call.id, content: toolOutput });
        }
        setMessages((old) => {
          const next = [...old];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: proposalPreview ?? "" };
          if (proposalPreview) next.push({ role: "assistant", content: "" });
          return next;
        });
      }
      if (!completed) {
        if (!answer.includes("limit reached:")) {
          const reached = budget.getLimitReached() ?? "rounds";
          answer = formatLimitMessage(reached, budget, "The requested task may still need implementation, verification, or error fixing.");
        }
        setMessages((old) => {
          const next = [...old];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: answer };
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
      setInput(value.slice(0, pos) + "\n" + value.slice(pos));
      setCursorPos(pos + 1);
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
          borderStyle="rounded"
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
      <box flexDirection="row" justifyContent="space-between" backgroundColor={colors.panel} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
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
        <box flexDirection="row" gap={2} minWidth={0} flexShrink={0}>
          <Show when={terminal().width >= 60}>
            <text fg={colors.lavender} wrapMode="none" flexShrink={0}>✧ {getSessionTitle()} ✧</text>
          </Show>
          <Show when={terminal().width >= 48}>
            <text fg={status() === "connected" ? colors.mint : status() === "error" ? colors.red : colors.peach} wrapMode="none" flexShrink={0}>
              {status() === "connected" ? "● connected" : status() === "error" ? "● error" : "◌ connecting"}
            </text>
          </Show>
          <Show when={terminal().width < 48}>
            <text fg={status() === "connected" ? colors.mint : status() === "error" ? colors.red : colors.peach} wrapMode="none" flexShrink={0}>
              {status() === "connected" ? "●" : status() === "error" ? "✗" : "◌"}
            </text>
          </Show>
        </box>
      </box>

      <box flexDirection="row" gap={1} flexGrow={1} minWidth={0} minHeight={0} width="100%" overflow="hidden">
        <Show when={sidebarVisible()}>
        <box flexDirection="column" backgroundColor={colors.panel} padding={1} width={32} minWidth={28} height="100%" minHeight={0} flexShrink={0} gap={1} overflow="hidden">
          <box flexDirection="column" gap={0} flexShrink={0} onMouseDown={() => { setCatMenuOpen((open) => !open); setCatMenuIndex(0); setCatExpressionPicker(false); }}>
            <CatPortrait
              height={terminal().height > 22 ? (terminal().height > 32 ? 12 : Math.max(6, terminal().height - 22)) : 6}
              expression={catProfile().selectedExpression as CatExpressionId}
              mood={catMood()}
              frame={catFrame()}
              animated={catProfile().animationsEnabled}
            />
            <text fg={colors.pink} textAlign="center">MINT THE CAT</text>
            <text fg={colors.muted} textAlign="center">click or press F2 · /cat</text>
          </box>
          <text fg={colors.muted} width="100%" minWidth={0} flexShrink={0} wrapMode="none" truncate={true}>{catProfile().pets} pets · {catProfile().treats} treats</text>
          <box flexDirection="column" gap={1} width="100%" minWidth={0} flexShrink={0}>
          <Show when={session()}>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>────────────────</text>
            <text fg={colors.lavender} width="100%" minWidth={0} wrapMode="none" truncate={true}>SESSION</text>
            <text
              fg={colors.text}
              width="100%"
              minWidth={0}
              wrapMode="none"
              truncate={true}
              onMouseUp={(e) => { e.stopPropagation(); openRenamePopup(); }}
            >
              {getSessionTitle()}
            </text>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>#{session()}</text>
          </Show>
          <Show when={!session()}>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>────────────────</text>
            <text fg={colors.lavender} width="100%" minWidth={0} wrapMode="none" truncate={true}>SESSION</text>
            <text fg={colors.text} width="100%" minWidth={0} wrapMode="none" truncate={true}>{draftSessionTitle() || "new session"}</text>
            <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>draft · saved on first message</text>
          </Show>
          <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>────────────────</text>
          <text fg={colors.mint} width="100%" minWidth={0} wrapMode="none" truncate={true}>MODEL</text>
          <text
            fg={colors.text}
            width="100%"
            minWidth={0}
            wrapMode="none"
            truncate={true}
            onMouseUp={(e) => { e.stopPropagation(); openModelPicker(); }}
          >
            {model() || "not selected"}
          </text>
          <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>────────────────</text>
          <text fg={colors.peach} width="100%" minWidth={0} wrapMode="none" truncate={true}>STATUS</text>
          <text
            fg={colors.text}
            width="100%"
            minWidth={0}
            wrapMode="none"
            truncate={true}
            onMouseUp={(e) => { e.stopPropagation(); openConnectPopup(); }}
          >
            {notice()}
          </text>
        </box>
      </box>
      </Show>

        <box flexGrow={1} minWidth={0} minHeight={0} width="100%" flexDirection="column" backgroundColor={colors.panel} padding={1} gap={1} overflow="hidden">
          <box flexDirection="row" justifyContent="space-between" width="100%" minWidth={0} flexShrink={0} overflow="hidden">
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
              {(message) => (
                <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                  <text fg={message.role === "user" ? colors.mint : message.role === "system" ? colors.muted : colors.pink}>
                    {message.role === "user" ? "you ❯" : "mint ♡ · answer"}
                  </text>
                  <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                    {message.content
                      ? parseMessageSegments(message.content).map((seg) => renderSegment(seg, colors))
                      : busy()
                      ? <text fg={colors.peach} wrapMode="word" width="100%">Waiting for the response…</text>
                      : null
                    }
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
          <Show when={commandSuggestions().length > 0 && !modelPickerOpen()}>
            <box backgroundColor={colors.bg} borderStyle="rounded" borderColor={colors.lavender} padding={1} flexDirection="column" gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden" onMouseScroll={(e) => { e.stopPropagation(); }}>
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
          <box backgroundColor={colors.bg} padding={1} flexDirection="column" gap={1} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
            <text fg={colors.mint} width="100%" minWidth={0} wrapMode="char">❯ {input().slice(0, cursorPos())}▌{input().slice(cursorPos())}</text>
              <box flexDirection="row" gap={2} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
              <text fg={mode() === "plan" ? colors.lavender : colors.mint} wrapMode="none">
                {mode() === "plan" ? "◆ PLAN MODE" : "◆ BUILD MODE"}
              </text>
              <text fg={colors.muted} wrapMode="none">Shift+Tab to toggle</text>
            </box>
            <Show when={busy()}>
              <box flexDirection="row" gap={1} width="100%" minWidth={0} flexShrink={0} overflow="hidden" paddingLeft={1}>
                <RunCatIndicator busy={true} speed={runCatSpeed()} />
              </box>
            </Show>
          </box>
        </box>
      </box>
      <Show when={terminal().height >= 24 && commandSuggestions().length === 0}>
        <text fg={colors.muted} width="100%" minWidth={0} flexShrink={0} wrapMode="none" truncate={true}>{footerText()}</text>
      </Show>

      {/* Top-right toast notification */}
      <Show when={toast() !== null}>
        <box
          position="absolute"
          top={1}
          right={2}
          zIndex={50}
          backgroundColor={colors.panel}
          borderStyle="rounded"
          borderColor={colors.mint}
          paddingLeft={1}
          paddingRight={1}
          onMouseUp={(e) => { e.stopPropagation(); setToast(null); if (toastTimer) clearTimeout(toastTimer); }}
        >
          <text fg={colors.mint} wrapMode="none" truncate={true} width={40}>{toast()}</text>
        </box>
      </Show>

      {/* Connect popup */}
      <Show when={connectOpen()}>
        <ModalFrame
          onClose={closeConnectPopup}
          title="✿ CONNECT NVIDIA"
          width={72}
          minWidth={40}
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
        <box backgroundColor={colors.bg} borderStyle="rounded" borderColor={colors.lavender} padding={1} flexDirection="column" gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden" onMouseScroll={(e) => handleWheel(e, (d) => setModelPickerIndex(movePickerIndex(modelPickerIndex(), d, modelPickerSuggestions().length)))} >
          <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
            <text fg={colors.lavender} wrapMode="none" width="100%" minWidth={0} truncate={true}>{modelPickerHeader()}</text>
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
          width={60}
          minWidth={30}
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
          width={80}
          minWidth={50}
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
          title="✿ MINT THE CAT"
          width={terminal().width >= 80 ? 76 : 56}
          minWidth={36}
          borderColor={colors.pink}
        >
        <box flexDirection={terminal().width >= 80 ? "row" : "column"} gap={2} width="100%" minWidth={0} alignItems={terminal().width >= 80 ? "flex-start" : "center"}>
          <CatPortrait
            height={terminal().width >= 80 ? Math.min(24, terminal().height - 8) : 18}
            expression={catProfile().selectedExpression as CatExpressionId}
            mood={catMood()}
            frame={catFrame()}
            animated={catProfile().animationsEnabled}
          />
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
