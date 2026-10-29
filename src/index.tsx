import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { loadConfig } from "./config";
import { AgentTurnBudget, formatLimitMessage, RepeatedCallGuard } from "./agent-loop";
import { NvidiaClient, type ChatMessage, type NvidiaModel, type ToolCall } from "./nvidia";
import { buildSystemPrompt, executeModelTool, getCapabilities, getModelTools } from "./agent-tools";
import { SessionStore, type StoredMessage } from "./storage";
import { WorkspaceTools } from "./tools";
import { ApprovedTerminal } from "./terminal";
import { CAT_EXPRESSIONS, catProfileSummary, catSprite, feedCat, petCat, selectCatExpression, type CatMood } from "./cat";
import type { CatProfile } from "./storage";

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
    { command: "/new", description: "Start a new session" },
    { command: "/sessions", description: "List saved sessions" },
    { command: "/resume ", description: "Resume a session by ID" },
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
      return models().filter((entry) => entry.id.toLowerCase().includes(query)).slice(0, 7).map((entry) => ({ command: `/model ${entry.id}`, description: "Select this model" }));
    }
    if (value.includes(" ")) return [];
    // Keep the picker compact; typing filters the complete command list.
    return commands.filter((item) => item.command.trim().startsWith(value)).slice(0, 5);
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
  const [session, setSession] = createSignal(store.createSession().id);
  let client: NvidiaClient | undefined;
  let configuredModel = "";
  let lastUserPrompt = "";
  let activeController: AbortController | undefined;
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();

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

  const send = async () => {
    const rawText = input();
    const text = rawText.trim();
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
    if (text === "/sessions") {
      const sessions = store.listSessions();
      const listing = sessions.map((item) => `${item.id}  ${item.title}  [${item.model || "no model"}]`).join("\n");
      setMessages((old) => [...old, { role: "assistant", content: `Recent sessions:\n${listing || "No saved sessions yet."}\n\nResume with /resume <id>.` }]);
      return;
    }
    if (text.startsWith("/resume ")) {
      resumeSession(text.slice(8).trim());
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
        content: "Commands: /help · /cat · /pet · /feed · /expressions · /expression <id> · /models · /model <id> · /new · /sessions · /resume <id> · /workspace · /project · /capabilities · /ls [path] · /read <path> · /search <text> · /propose <path> · /apply · /reject · /command <program args> · /run · /reject-command · /cancel · /clear · /quit\n\nFile changes require explicit /apply approval. Terminal commands are restricted, previewed, and run only after explicit /run approval. Web browsing remains unavailable.",
      }]);
      return;
    }
    if (text === "/models") {
      await refreshModels();
      setMessages((old) => [...old, { role: "assistant", content: `Available NVIDIA models:\n${models().map((m) => `• ${m.id}`).join("\n") || notice()}` }]);
      return;
    }
    if (text.startsWith("/model ")) {
      const requested = text.slice(7).trim();
      const found = models().find((entry) => entry.id === requested);
      if (found) {
        setModel(found.id);
        store.updateModel(session(), found.id);
        setNotice(`Model set to ${found.id}`);
        setMessages((old) => [...old, { role: "assistant", content: `♡ Model set to ${found.id}` }]);
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

  useKeyboard((key) => {
    const value = input();
    const pos = cursorPos();
    const suggestions = commandSuggestions();
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
    if (key.ctrl && !key.shift && key.name === "c") {
      if (activeController) activeController.abort();
      else { store.close(); renderer.destroy(); }
      return;
    }
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
      <box flexDirection="row" justifyContent="space-between" backgroundColor={colors.panel} padding={1}>
        <box flexDirection="row" gap={1}><text fg={colors.pink}>✿ M I N T</text><text fg={colors.muted}>/ tiny coding companion</text></box>
        <text fg={status() === "connected" ? colors.mint : status() === "error" ? colors.red : colors.peach}>
          {status() === "connected" ? "● NVIDIA connected" : status() === "error" ? "● needs attention" : "◌ connecting"}
        </text>
      </box>

      <box flexDirection="row" gap={1} flexGrow={1} minWidth={0} width="100%">
        <Show when={terminal().width >= 100}>
        <box flexDirection="column" backgroundColor={colors.panel} padding={1} width={32} minWidth={28} gap={1}>
          <box flexDirection="column" gap={0} onMouseDown={() => { setCatMenuOpen((open) => !open); setCatMenuIndex(0); setCatExpressionPicker(false); }}>
            <For each={catSprite(catProfile().selectedExpression, catFrame(), catMood())}>{(line) => <text fg={catMood() === "error" ? colors.red : catMood() === "happy" || catMood() === "love" ? colors.pink : colors.lavender}>{line}</text>}</For>
            <text fg={colors.pink}>[ MINT THE CAT ]</text>
            <text fg={colors.muted}>click or press F2 · /cat</text>
          </box>
          <text fg={colors.muted}>{catProfile().pets} pets · {catProfile().treats} treats</text>
          <Show when={catMenuOpen()}>
            <box flexDirection="column" borderStyle="rounded" borderColor={colors.pink} padding={1} gap={0}>
              <Show when={catExpressionPicker()}>
                <text fg={colors.pink}>--- EXPRESSIONS ---</text>
                <For each={CAT_EXPRESSIONS}>{(expression, index) => <text fg={index() === catExpressionIndex() ? colors.mint : catProfile().unlockedExpressions.includes(expression.id) ? colors.text : colors.muted}>{index() === catExpressionIndex() ? "❯ " : "  "}{catProfile().unlockedExpressions.includes(expression.id) ? "◆" : "[locked]"} {expression.label}</text>}</For>
                <text fg={colors.muted}>↑/↓ choose · Enter equip · Esc back</text>
              </Show>
              <Show when={!catExpressionPicker()}>
                <text fg={colors.pink}>--- CAT MENU ---</text>
                <For each={catMenuItems}>{(item, index) => <text fg={index() === catMenuIndex() ? colors.mint : colors.text}>{index() === catMenuIndex() ? "❯ " : "  "}{item.shortcut}  {item.label} · {item.detail}</text>}</For>
                <text fg={colors.muted}>↑/↓ + Enter · Esc close</text>
              </Show>
            </box>
          </Show>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.mint}>MODEL</text>
          <text fg={colors.text}>{model() || "not selected"}</text>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.peach}>STATUS</text>
          <text fg={colors.text}>{notice()}</text>
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
        </box>
        </Show>

        <box flexGrow={1} minWidth={0} width="100%" flexDirection="column" backgroundColor={colors.panel} padding={1} gap={1}>
          <text fg={colors.lavender}>✧ chat ✧</text>
          <Show when={terminal().width < 100 && catMenuOpen()}>
            <box flexDirection="column" borderStyle="rounded" borderColor={colors.pink} padding={1} gap={0}>
              <Show when={catExpressionPicker()}>
                <text fg={colors.pink}>✦ CAT EXPRESSIONS ✦</text>
                <For each={CAT_EXPRESSIONS}>{(expression, index) => <text fg={index() === catExpressionIndex() ? colors.mint : catProfile().unlockedExpressions.includes(expression.id) ? colors.text : colors.muted}>{index() === catExpressionIndex() ? "❯ " : "  "}{catProfile().unlockedExpressions.includes(expression.id) ? "◆" : "[locked]"} {expression.label}</text>}</For>
                <text fg={colors.muted}>↑/↓ choose · Enter equip · Esc back</text>
              </Show>
              <Show when={!catExpressionPicker()}>
                <text fg={colors.pink}>--- CAT MENU ---</text>
                <For each={catMenuItems}>{(item, index) => <text fg={index() === catMenuIndex() ? colors.mint : colors.text}>{index() === catMenuIndex() ? "❯ " : "  "}{item.shortcut}  {item.label} · {item.detail}</text>}</For>
                <text fg={colors.muted}>↑/↓ + Enter · Esc close</text>
              </Show>
            </box>
          </Show>
          <scrollbox flexGrow={1} minHeight={0} minWidth={0} width="100%" flexDirection="column" gap={1} stickyScroll={true} stickyStart="bottom">
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
            <box backgroundColor={colors.bg} padding={1} flexDirection="column" gap={0}>
              <text fg={colors.lavender}>COMMANDS  ·  ↑/↓ select  ·  Tab complete</text>
              <For each={commandSuggestions()}>{(item, index) =>
                <box flexDirection="column" gap={0}>
                  <text fg={index() === commandIndex() ? colors.mint : colors.text}>
                    {index() === commandIndex() ? "❯ " : "  "}{item.command.trimEnd()}
                  </text>
                  <text fg={colors.muted}>    {item.description}</text>
                </box>
              }</For>
            </box>
          </Show>
          <box backgroundColor={colors.bg} padding={1} flexDirection="column" gap={1}>
            <text fg={colors.mint}>❯ {input().slice(0, cursorPos())}▌{input().slice(cursorPos())}</text><Show when={busy()}><text fg={colors.peach}>· generating answer</text></Show>
            <text fg={colors.muted}>Enter send · Shift+Enter newline · scroll chat as one timeline · F2 cat menu · /retry retry · /cancel stop</text>
          </box>
        </box>
      </box>
      <text fg={colors.muted}>Harness-aware tools · approval-gated file edits · NVIDIA NIM · made with ♡</text>
    </box>
  );
}

// Keep Ctrl+C under the app's keyboard handler. OpenTUI's built-in shortcut
// exits before we can distinguish Ctrl+C from Ctrl+Shift+C (terminal copy).
await render(() => <App />, { exitOnCtrlC: false, targetFps: 30 });
