import { render, useKeyboard, useRenderer, useTerminalDimensions, usePaste, useSelectionHandler } from "@opentui/solid";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { loadConfig, writeDotEnv, type MintConfig } from "./config";
import { AgentTurnBudget, formatLimitMessage, RepeatedCallGuard } from "./agent-loop";
import { NvidiaClient, type ChatMessage, type NvidiaModel, type ToolCall } from "./nvidia";
import { buildSystemPrompt, executeModelTool, getCapabilities, getModelTools } from "./agent-tools";
import { SessionStore, type StoredMessage } from "./storage";
import { WorkspaceTools } from "./tools";
import { ApprovedTerminal } from "./terminal";
import { CAT_EXPRESSIONS, catProfileSummary, catSprite, feedCat, petCat, selectCatExpression, type CatMood } from "./cat";
import type { CatProfile } from "./storage";
import {
  MAX_PASTE_CHARS,
  sanitizePastedText,
  insertAtCursor,
  normalizeApiKey,
  validateConnectDraft,
  maskSecret,
  nextConnectField,
  resolveConnectModel,
  type ConnectField,
} from "./connect";
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
    { command: "/retry", description: "Retry the last user message" },
    { command: "/model ", description: "Choose a model" },
    { command: "/connect", description: "Configure NVIDIA API credentials" },
    { command: "/session", description: "List or resume sessions" },
    { command: "/session new", description: "Start a fresh session" },
    { command: "/session delete ", description: "Delete a session" },
    { command: "/workspace", description: "Show workspace root" },
    { command: "/capabilities", description: "Show real harness capabilities" },
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
    if (value.startsWith("/model ")) {
      const query = value.slice(7).trim().toLowerCase();
      return models().filter((entry) => entry.id.toLowerCase().includes(query)).slice(0, commandLimit()).map((entry) => ({ command: `/model ${entry.id}`, description: "Select this model" }));
    }
    if (value.includes(" ")) return [];
    // Keep the picker compact; typing filters the complete command list.
    return commands.filter((item) => item.command.trim().startsWith(value)).slice(0, commandLimit());
  });
  const [messages, setMessages] = createSignal<ViewMessage[]>([
    { role: "assistant", content: "mrrp! I'm MINT. Type a message to chat, or /help for commands. ♡" },
  ]);
  const [models, setModels] = createSignal<NvidiaModel[]>([]);
  const [model, setModel] = createSignal("");
  const [status, setStatus] = createSignal("starting");
  const [busy, setBusy] = createSignal(false);
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

  const [session, setSession] = createSignal(store.createSession().id);
  let client: NvidiaClient | undefined;
  let configuredModel = "";
  let lastUserPrompt = "";
  let activeController: AbortController | undefined;
  const sidebarVisible = () => terminal().width >= 100;
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

  const persist = (message: StoredMessage) => store.addMessage(session(), message);
  const startNewSession = () => {
    const created = store.createSession(model());
    setSession(created.id);
    setHistory([systemMessage()]);
    setMessages([{ role: "assistant", content: `Fresh session ${created.id}! What are we building? ♡` }]);
    setNotice(`session ${created.id}`);
  };
  const resumeSession = (id: string) => {
    const found = store.getSession(id);
    if (!found) {
      setMessages((old) => [...old, { role: "assistant", content: `No session found with ID ${id}. Use /sessions to list sessions.` }]);
      return;
    }
    const stored = store.getMessages(id);
    setSession(id);
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

  // Connect popup handlers
  const openConnectPopup = () => {
    setConnectDraft({
      apiKey: "",
      baseUrl: configuredModel ? "" : "https://integrate.api.nvidia.com/v1",
      model: model() || configuredModel || "",
    });
    setConnectCursor({ apiKey: 0, baseUrl: 0, model: 0 });
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
      if (cursor > 0) {
        const { value: newValue, cursor: newCursor } = insertAtCursor(value, cursor, "");
        setConnectFieldValue(field, newValue);
        setConnectFieldCursor(field, newCursor);
      }
      return true;
    }
    if (key.name === "delete") {
      if (cursor < value.length) {
        const { value: newValue, cursor: newCursor } = insertAtCursor(value, cursor, "");
        setConnectFieldValue(field, newValue.slice(0, cursor) + value.slice(cursor + 1));
        setConnectFieldCursor(field, cursor);
      }
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
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.shift && !key.meta) {
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
    // Treat as session ID to resume
    resumeSession(sub);
  };

  const openSessionPicker = () => {
    setSessionPickerOpen(true);
    setSessionPickerIndex(0);
    const sessions = store.listSessions();
    if (sessions.length === 0) {
      setMessages((old) => [...old, { role: "assistant", content: "No saved sessions yet. Use /session new to create one." }]);
      setSessionPickerOpen(false);
      return;
    }
    const listing = sessions.map((s, i) => `${i + 1}. ${s.id}  ${s.title}  [${s.model || "no model"}]  ${new Date(s.created_at).toLocaleString()}`).join("\n");
    setMessages((old) => [...old, { role: "assistant", content: `Sessions (↑/↓ to navigate, Enter to resume, Esc to cancel):\n${listing}` }]);
    setNotice("session picker open");
  };

  const handleSessionPickerInput = async (text: string) => {
    // In the picker, we interpret input as navigation or direct selection
    const sessions = store.listSessions();
    if (text === "escape" || text === "esc") {
      setSessionPickerOpen(false);
      setMessages((old) => [...old, { role: "assistant", content: "Session picker closed." }]);
      setNotice("session picker closed");
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
        setSessionPickerOpen(false);
        resumeSession(selected.id);
      }
      return;
    }
    // Allow direct number entry
    const num = parseInt(text, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      setSessionPickerOpen(false);
      resumeSession(sessions[num - 1].id);
      return;
    }
  };

  const send = async () => {
    const rawText = input();
    const text = rawText.trim();

    // Handle session picker input
    if (sessionPickerOpen()) {
      await handleSessionPickerInput(text);
      setInput("");
      setCursorPos(0);
      return;
    }

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
    if (text === "/session" || text.startsWith("/session ")) {
      await handleSessionCommand(text);
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
      setMessages((old) => [...old, { role: "assistant", content: `MINT harness capabilities\nWorkspace: ${workspaceTools?.root ?? "not ready"}\n\n${listing}` }]);
      return;
    }
    if (text === "/help") {
      setMessages((old) => [...old, {
        role: "assistant",
        content: "Commands: /help · /cat · /pet · /feed · /expressions · /expression <id> · /models · /model <id> · /connect · /session · /session new · /session delete <id> · /workspace · /project · /capabilities · /ls [path] · /read <path> · /search <text> · /propose <path> · /apply · /reject · /command <program args> · /run · /reject-command · /cancel · /clear · /quit\n\nFile changes require explicit /apply approval. Terminal commands are restricted, previewed, and run only after explicit /run approval. Web browsing remains unavailable.",
      }]);
      return;
    }
    if (text === "/models") {
      await refreshModels();
      const modelList = models();
      if (modelList.length === 0) {
        setMessages((old) => [...old, { role: "assistant", content: `No models available. Check your NVIDIA API key and connection.` }]);
        return;
      }
      const current = model();
      const listing = modelList.map((m) => `${m.id === current ? "→ " : "  "}${m.id}${m.id === current ? " (current)" : ""}`).join("\n");
      setMessages((old) => [...old, { role: "assistant", content: `Available NVIDIA models:\n${listing}\n\nUse /model <id> to switch.` }]);
      return;
    }
    if (text.startsWith("/model ")) {
      const requested = text.slice(7).trim();
      const found = models().find((entry) => entry.id === requested);
      if (found) {
        setModel(found.id);
        store.updateModel(session(), found.id);
        setNotice(`Model set to ${found.id}`);
        setMessages((old) => [...old, { role: "assistant", content: `♡ Model set to ${found.id} (session only). Use /connect to persist to .env.` }]);
      } else {
        setMessages((old) => [...old, { role: "assistant", content: `I can't find that model in the current NVIDIA catalog. Try /models first.` }]);
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
  }, 650);
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

    // Global copy/paste shortcuts (work when not in popup)
    if (!connectOpen() && !sessionPickerOpen() && !catMenuOpen()) {
      // Ctrl+Shift+V or Ctrl+V or Shift+Insert - paste from clipboard
      if (((key.ctrl && key.shift && key.name === "v") || (key.ctrl && key.name === "v") || (key.name === "insert" && key.shift)) && !key.meta) {
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
      if (key.name === "escape") { setSessionPickerOpen(false); setMessages((old) => [...old, { role: "assistant", content: "Session picker closed." }]); setNotice("session picker closed"); return; }
      if (key.name === "up") { setSessionPickerIndex((old) => (old - 1 + store.listSessions().length) % store.listSessions().length); return; }
      if (key.name === "down") { setSessionPickerIndex((old) => (old + 1) % store.listSessions().length); return; }
      if (key.name === "return") {
        const sessions = store.listSessions();
        const selected = sessions[sessionPickerIndex()];
        if (selected) { setSessionPickerOpen(false); resumeSession(selected.id); }
        return;
      }
      // Allow number keys 1-9 for direct selection
      const num = parseInt(key.sequence || "", 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        const sessions = store.listSessions();
        if (num <= sessions.length) { setSessionPickerOpen(false); resumeSession(sessions[num - 1].id); }
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
      ((!key.ctrl && !key.meta) || key.sequence.length > 1)
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

  return (
    <box flexDirection="column" backgroundColor={colors.bg} padding={1} gap={1} width="100%" height="100%">
      <box flexDirection="row" justifyContent="space-between" backgroundColor={colors.panel} padding={1} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
        <box flexDirection="row" gap={1} minWidth={0} flexShrink={1}>
          <text fg={colors.pink} wrapMode="none" flexShrink={0}>✿ M I N T</text>
          <Show when={terminal().width >= 64}>
            <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>/ tiny coding companion</text>
          </Show>
        </box>
        <text fg={status() === "connected" ? colors.mint : status() === "error" ? colors.red : colors.peach} wrapMode="none" flexShrink={0}>
          {terminal().width >= 56 ? (status() === "connected" ? "● NVIDIA connected" : status() === "error" ? "● needs attention" : "◌ connecting") : "●"}
        </text>
      </box>

      <box flexDirection="row" gap={1} flexGrow={1} minWidth={0} minHeight={0} width="100%" overflow="hidden">
        <Show when={sidebarVisible()}>
        <box flexDirection="column" backgroundColor={colors.panel} padding={1} width={32} minWidth={28} height="100%" minHeight={0} flexShrink={0} gap={1} overflow="hidden">
          <box flexDirection="column" gap={0} flexShrink={0} onMouseDown={() => { setCatMenuOpen((open) => !open); setCatMenuIndex(0); setCatExpressionPicker(false); }}>
            <For each={catSprite(catProfile().selectedExpression, catFrame(), catMood())}>{(line) => <text fg={catMood() === "error" ? colors.red : catMood() === "happy" || catMood() === "love" ? colors.pink : colors.lavender}>{line}</text>}</For>
            <text fg={colors.pink}>[ MINT THE CAT ]</text>
            <text fg={colors.muted}>click or press F2 · /cat</text>
          </box>
          <text fg={colors.muted} width="100%" minWidth={0} flexShrink={0} wrapMode="none" truncate={true}>{catProfile().pets} pets · {catProfile().treats} treats</text>
          <scrollbox flexGrow={1} minHeight={0} width="100%" minWidth={0} contentOptions={{ flexDirection: "column", gap: 1 }}>
          <Show when={catMenuOpen()}>
            <box flexDirection="column" borderStyle="rounded" borderColor={colors.pink} padding={1} gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
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
                <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>↑/↓ choose · Enter · Esc</text>
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
                <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>↑/↓ + Enter · Esc close</text>
              </Show>
            </box>
          </Show>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.mint}>MODEL</text>
          <text fg={colors.text} width="100%" minWidth={0} wrapMode="none" truncate={true}>{model() || "not selected"}</text>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.peach}>STATUS</text>
          <text fg={colors.text} width="100%" minWidth={0} wrapMode="none" truncate={true}>{notice()}</text>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.muted}>/cat   interact with cat</text>
          <text fg={colors.muted}>/pet   pet the cat</text>
          <text fg={colors.muted}>/feed  give a treat</text>
          <text fg={colors.muted}>/help  commands</text>
          <text fg={colors.muted}>/ls    list files</text>
          <text fg={colors.muted}>/read  read a file</text>
          <text fg={colors.muted}>/search find text</text>
          <text fg={colors.muted}>/propose edit file</text>
          <text fg={colors.muted}>/capabilities tools</text>
          <text fg={colors.muted}>/apply approve diff</text>
          <text fg={colors.muted}>/quit  exit</text>
          </scrollbox>
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
          <Show when={!sidebarVisible() && catMenuOpen()}>
            <box flexDirection="column" borderStyle="rounded" borderColor={colors.pink} padding={1} gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
              <Show when={catExpressionPicker()}>
                <text fg={colors.pink}>✦ CAT EXPRESSIONS ✦</text>
                <For each={CAT_EXPRESSIONS}>{(expression, index) =>
                  <box
                    flexDirection="row"
                    width="100%"
                    minWidth={0}
                    height={1}
                    minHeight={1}
                    overflow="hidden"
                    backgroundColor={index() === catExpressionIndex() ? colors.lavender : colors.panel}
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
                <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>↑/↓ choose · Enter · Esc</text>
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
                <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>↑/↓ + Enter · Esc close</text>
              </Show>
            </box>
          </Show>
          <scrollbox flexGrow={1} minHeight={0} minWidth={0} width="100%" contentOptions={{ flexDirection: "column", gap: 1 }} stickyScroll={true} stickyStart="bottom">
            <For each={messages()}>
              {(message) => (
                <box flexDirection="column" gap={0} width="100%" minWidth={0}>
                  <text fg={message.role === "user" ? colors.mint : message.role === "system" ? colors.muted : colors.pink}>
                    {message.role === "user" ? "you ❯" : "mint ♡ · answer"}
                  </text>
                  <text fg={colors.text} wrapMode="word" width="100%">{message.content || (busy() ? "Waiting for the response…" : "")}</text>
                </box>
              )}
            </For>
          </scrollbox>
          <Show when={commandSuggestions().length > 0}>
            <box backgroundColor={colors.bg} borderStyle="rounded" borderColor={colors.lavender} padding={1} flexDirection="column" gap={0} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
              <box height={1} minHeight={1} width="100%" minWidth={0} overflow="hidden">
                <text fg={colors.lavender} wrapMode="none" width="100%" minWidth={0} truncate={true}>{commandPaletteHeader()}</text>
              </box>
              <For each={commandSuggestions()}>{(item, index) =>
                <box
                  flexDirection="row"
                  width="100%"
                  minWidth={0}
                  height={1}
                  minHeight={1}
                  overflow="hidden"
                  backgroundColor={index() === commandIndex() ? colors.lavender : colors.bg}
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
              }</For>
            </box>
          </Show>
          <box backgroundColor={colors.bg} padding={1} flexDirection="column" gap={1} width="100%" minWidth={0} flexShrink={0} overflow="hidden">
            <text fg={colors.mint} width="100%" minWidth={0} wrapMode="char">❯ {input().slice(0, cursorPos())}▌{input().slice(cursorPos())}</text><Show when={busy()}><text fg={colors.peach} width="100%" minWidth={0} wrapMode="none" truncate={true}>· generating answer</text></Show>
            <Show when={terminal().height >= 24 && commandSuggestions().length === 0}>
              <text fg={colors.muted} width="100%" minWidth={0} wrapMode="none" truncate={true}>{inputHint()}</text>
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
        >
          <text fg={colors.mint} wrapMode="none" truncate={true} width={40}>{toast()}</text>
        </box>
      </Show>

      {/* Connect popup */}
      <Show when={connectOpen()}>
        <box
          position="absolute"
          top={Math.max(2, Math.floor(terminal().height / 2) - 10)}
          left={Math.max(2, Math.floor((terminal().width - Math.min(72, terminal().width - 4)) / 2))}
          width={Math.min(72, terminal().width - 4)}
          minWidth={40}
          backgroundColor={colors.panel}
          borderStyle="rounded"
          borderColor={colors.pink}
          padding={1}
          gap={1}
          flexShrink={0}
        >
          <text fg={colors.pink} wrapMode="none" width="100%">✿ CONNECT NVIDIA</text>
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
            <text fg={colors.muted} wrapMode="none" width="100%" minWidth={0} truncate={true}>Tab next · Shift+Tab prev · Enter connect · Esc cancel · Ctrl+Shift+V paste</text>
          </Show>
        </box>
      </Show>
    </box>
  );
}

// Keep Ctrl+C under the app's keyboard handler. OpenTUI's built-in shortcut
// exits before we can distinguish Ctrl+C from Ctrl+Shift+C (terminal copy).
await render(() => <App />, { exitOnCtrlC: false, targetFps: 30 });
