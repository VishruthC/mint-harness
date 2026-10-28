import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import { loadConfig } from "./config";
import { NvidiaClient, type ChatMessage, type NvidiaModel } from "./nvidia";
import { SessionStore, type StoredMessage } from "./storage";
import { WorkspaceTools } from "./tools";

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
    { command: "/models", description: "List NVIDIA models" },
    { command: "/model ", description: "Choose a model" },
    { command: "/new", description: "Start a new session" },
    { command: "/sessions", description: "List saved sessions" },
    { command: "/resume ", description: "Resume a session by ID" },
    { command: "/workspace", description: "Show workspace root" },
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
    return commands.filter((item) => item.command.trim().startsWith(value)).slice(0, 7);
  });
  const [messages, setMessages] = createSignal<ViewMessage[]>([
    { role: "assistant", content: "mrrp! I'm MINT. Type a message to chat, or /help for commands. ♡" },
  ]);
  const [models, setModels] = createSignal<NvidiaModel[]>([]);
  const [model, setModel] = createSignal("");
  const [status, setStatus] = createSignal("starting");
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal("Connecting to NVIDIA…");
  const systemMessage: ChatMessage = { role: "system", content: "You are MINT, a helpful and friendly coding assistant. Be concise, practical, and careful. Never reveal private chain-of-thought or provide a step-by-step internal thinking transcript; give the answer directly with only a brief rationale when useful. You can inspect workspace files and propose edits using MINT's explicit approval workflow, but you cannot execute terminal commands. Never claim an operation succeeded unless the app confirms it." };
  const [history, setHistory] = createSignal<ChatMessage[]>([systemMessage]);
  const store = new SessionStore();
  let workspaceTools: WorkspaceTools | undefined;
  let awaitingWritePath: string | undefined;
  let pendingProposalId: string | undefined;
  void WorkspaceTools.create().then((tools) => {
    workspaceTools = tools;
    setNotice(`workspace: ${tools.root}`);
  }).catch((error) => {
    setNotice(error instanceof Error ? error.message : "Workspace initialization failed");
  });
  const [session, setSession] = createSignal(store.createSession().id);
  let client: NvidiaClient | undefined;
  let configuredModel = "";
  let activeController: AbortController | undefined;
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();

  const persist = (message: StoredMessage) => store.addMessage(session(), message);
  const startNewSession = () => {
    const created = store.createSession(model());
    setSession(created.id);
    setHistory([systemMessage]);
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
    setHistory([systemMessage, ...stored.filter((m) => m.role !== "system")]);
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
      if (result.ok) pendingProposalId = undefined;
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
    if (text === "/help") {
      setMessages((old) => [...old, {
        role: "assistant",
        content: "Commands: /help · /models · /model <id> · /new · /sessions · /resume <id> · /workspace · /ls [path] · /read <path> · /search <text> · /propose <path> · /apply · /reject · /cancel-write · /cancel · /clear · /quit\n\nFile changes require a full-content preview and explicit /apply approval. Terminal execution is not enabled.",
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

    setMessages((old) => [...old, { role: "user", content: text }, { role: "assistant", content: "" }]);
    persist({ role: "user", content: text });
    const updatedHistory: ChatMessage[] = [...history(), { role: "user", content: text }];
    setHistory(updatedHistory);
    setBusy(true);
    activeController = new AbortController();
    setNotice(`thinking with ${model()}…`);

    try {
      let answer = "";
      for await (const token of client.streamChat(model(), updatedHistory, activeController.signal)) {
        answer += token;
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
    } finally {
      activeController = undefined;
      setBusy(false);
    }
  };

  try {
    const config = loadConfig();
    client = new NvidiaClient(config.apiKey, config.baseUrl);
    configuredModel = config.preferredModel;
    setModel(config.preferredModel);
    void refreshModels();
  } catch (error) {
    setStatus("error");
    setNotice(error instanceof Error ? error.message : "Configuration error");
  }

  useKeyboard((key) => {
    const value = input();
    const pos = cursorPos();
    const suggestions = commandSuggestions();
    if (key.ctrl && key.name === "c") {
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
      // Argument-taking commands (e.g. /read, /search, /model) should
      // complete into the input on Enter, leaving the cursor ready for args.
      // Only execute a command directly when it is complete and takes no args.
      if (suggestions.length && (!exactCommand || exactCommand.command.endsWith(" "))) {
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
    } else if (key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
      setInput(value.slice(0, pos) + key.sequence + value.slice(pos));
      setCursorPos(pos + key.sequence.length);
    }
  });

  return (
    <box flexDirection="column" backgroundColor={colors.bg} padding={1} gap={1} width="100%" height="100%">
      <box flexDirection="row" justifyContent="space-between" backgroundColor={colors.panel} padding={1}>
        <text fg={colors.pink}>✿ M I N T <span fg={colors.muted}>/ tiny coding companion</span></text>
        <text fg={status() === "connected" ? colors.mint : status() === "error" ? colors.red : colors.peach}>
          {status() === "connected" ? "● NVIDIA connected" : status() === "error" ? "● needs attention" : "◌ connecting"}
        </text>
      </box>

      <box flexDirection="row" gap={1} flexGrow={1} minWidth={0} width="100%">
        <Show when={terminal().width >= 100}>
        <box flexDirection="column" backgroundColor={colors.panel} padding={1} width={24} minWidth={20} gap={1}>
          <text fg={colors.lavender}> /\_/\\</text>
          <text fg={colors.lavender}>( o.o )</text>
          <text fg={colors.lavender}> &gt; ^ &lt;</text>
          <text fg={colors.pink}>♡ hello, friend ♡</text>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.mint}>MODEL</text>
          <text fg={colors.text}>{model() || "not selected"}</text>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.peach}>STATUS</text>
          <text fg={colors.text}>{notice()}</text>
          <text fg={colors.muted}>────────────────</text>
          <text fg={colors.muted}>/help  commands</text>
          <text fg={colors.muted}>/ls    list files</text>
          <text fg={colors.muted}>/read  read a file</text>
          <text fg={colors.muted}>/search find text</text>
          <text fg={colors.muted}>/propose edit file</text>
          <text fg={colors.muted}>/apply approve diff</text>
          <text fg={colors.muted}>/quit  exit</text>
        </box>
        </Show>

        <box flexGrow={1} minWidth={0} flexDirection="column" backgroundColor={colors.panel} padding={1} gap={1}>
          <text fg={colors.lavender}>✧ chat ✧</text>
          <box flexGrow={1} minWidth={0} width="100%" flexDirection="column" gap={1}>
            <For each={messages()}>
              {(message) => (
                <box flexDirection="column" gap={0}>
                  <text fg={message.role === "user" ? colors.mint : message.role === "system" ? colors.muted : colors.pink}>
                    {message.role === "user" ? "you ❯" : "mint ♡ · answer"}
                  </text>
                  <text fg={colors.text} wrapMode="word">{message.content || (busy() ? "Waiting for the response…" : "")}</text>
                </box>
              )}
            </For>
          </box>
          <Show when={commandSuggestions().length > 0}>
            <box backgroundColor={colors.bg} padding={1} flexDirection="column" gap={0}>
              <text fg={colors.lavender}>Commands · ↑/↓ navigate · Tab complete · Enter run</text>
              <For each={commandSuggestions()}>{(item, index) =>
                <text fg={index() === commandIndex() ? colors.mint : colors.muted}>
                  {index() === commandIndex() ? "❯ " : "  "}{item.command.trimEnd()}  <span fg={colors.muted}>{item.description}</span>
                </text>
              }</For>
            </box>
          </Show>
          <box backgroundColor={colors.bg} padding={1} flexDirection="column" gap={1}>
            <text fg={colors.mint}>❯ {input().slice(0, cursorPos())}<span fg={colors.text}>▌</span>{input().slice(cursorPos())}<Show when={busy()}><span fg={colors.peach}>  · generating answer</span></Show></text>
            <text fg={colors.muted}>Enter send · Shift+Enter newline · /cancel stop · Esc clear input</text>
          </box>
        </box>
      </box>
      <text fg={colors.muted}>Read-only workspace tools · NVIDIA NIM · made with ♡</text>
    </box>
  );
}

await render(() => <App />, { exitOnCtrlC: true, targetFps: 30 });
