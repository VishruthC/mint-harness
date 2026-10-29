# ✿ MINT

A cute, terminal-native coding harness inspired by OpenCode's architecture, independently implemented and **NVIDIA API-only**.

> Current milestone: Interactive MINT harness — OpenTUI chat, NVIDIA NIM streaming, SQLite sessions, model-callable workspace tools, targeted patch proposals, project-context discovery, approval-gated restricted terminal commands, repeated-tool-loop safeguards, and a persistent pixel-cat companion. Web browsing is not implemented.

## Requirements

- Bun **1.3.14+** (OpenTUI's current runtime requirement; see its runtime matrix)
- An NVIDIA API key with access to at least one hosted model
- A supported terminal (Linux x64, macOS, or Windows x64/WSL; see OpenTUI's current platform matrix)

## Start

```powershell
bun install
Copy-Item .env.example .env
notepad .env
bun run dev
```

In `.env`, set `NVIDIA_API_KEY` to your NVIDIA API key. Optionally set `NVIDIA_MODEL` to a model ID available to your account. `MINT_MAX_TOOL_ROUNDS` and `MINT_MAX_TOOL_CALLS_PER_TURN` configure the per-user-turn agent limits (defaults: `12` rounds and `24` calls); both must be positive integers. Do not share or commit `.env`.

MINT uses `https://integrate.api.nvidia.com/v1` by default. Set `NVIDIA_MODEL` to a model ID you can access, or leave it blank and choose from the models returned by the API.

## Current commands

- `/help` — show available commands
- `/models` — refresh and list NVIDIA models
- `/model <id>` — select a model (session only)
- `/connect` — configure NVIDIA API credentials (opens secure popup)
- `/session` — list or resume sessions (interactive picker)
- `/session new` — start a fresh session
- `/session delete <id>` — delete a session
- `/cancel` — cancel an in-progress response
- `/clear` — start a fresh session (old sessions remain saved)
- `/quit` — exit MINT
- `Shift+Enter` — insert a newline; `Enter` sends

### Clipboard shortcuts

- `Ctrl+Shift+V` / `Ctrl+V` / `Shift+Insert` — paste from system clipboard
- `Ctrl+Shift+C` — copy current selection (shows toast notification)
- `Ctrl+C` — copy selection if one exists, otherwise abort/exit
- Mouse selection — automatically copies to clipboard on release

### Secure `/connect` popup

`/connect` opens a centered in-TUI popup for API key entry:

- API key input is **always masked** (shows `•` characters)
- Paste your key with `Ctrl+Shift+V` — the raw key never appears in chat history, logs, or SQLite
- Tab/Shift+Tab to navigate between API Key, Base URL, and Model fields
- Enter to test connection and save to `.env`; Esc to cancel
- Connection is validated against NVIDIA before writing

No local-model or alternate-cloud-provider setup is included.

## Session storage

Conversation history is stored in SQLite at `~/.mint/mint.sqlite` by default. Set `MINT_DATA_DIR` to change the data directory. The directory is created with restrictive permissions and the database file is set to owner-only permissions where supported. Back up this file if you want to preserve sessions.

### Session management

- `/session` — opens interactive picker (↑/↓ to navigate, Enter to resume, Esc to cancel, or type 1-9)
- `/session <id>` — resume a specific session directly
- `/session new` — create a fresh session
- `/session delete <id>` — remove a saved session

Each session stores its own model selection, which is restored on resume.

## Security notes

- Never commit `.env` or paste an API key into source code.
- This version reads the key from `NVIDIA_API_KEY`; OS credential-store integration remains a follow-up. Keep `.env` private and do not commit it.
- MINT has a capability registry that generates the system prompt and model-callable tool list from the actual active workspace state.
- The model can invoke workspace listing, reading, searching, and file-proposal tools through the NVIDIA-compatible tool-call API. Tool results are returned to the model before it produces a final answer.
- MINT can inspect workspace files and supports explicit approval-gated file replacement proposals.
- Terminal commands are allowlisted, previewed with the working directory and timeout, and executed only after the user explicitly types `/run`. The model can propose commands but cannot approve them. Shell operators/redirection are blocked; command arguments can still have side effects, so inspect every preview. Web browsing and external-app control are unavailable.
- MINT respects common root `.gitignore` patterns while listing/searching and can discover project manifests, README/AGENTS files, and project type with `/project` or `workspace_project_context`.
- Small file edits can use exact-text patch proposals; every patch still requires `/apply`. Replacement preserves existing file permission bits where supported.
- To check the project on Windows PowerShell, run `bun run check:windows` (or run `bun run typecheck` and `bun test` separately).

## Architecture (initial slice)

```text
OpenTUI + SolidJS
       │
       ▼
Chat/session state ─── NVIDIA provider client
       │                        │
       ▼                        ▼
Conversation UI          /v1/models
                         /v1/chat/completions (SSE)
```

## References

- OpenTUI docs: https://opentui.com/docs/
- OpenTUI runtime support: https://opentui.com/docs/getting-started/runtime-support/
- NVIDIA NIM LLM APIs: https://docs.api.nvidia.com/nim/reference/llm-apis

## License

The MINT source is currently provided for private development. Add a project license before redistributing.


## Read-only workspace tools (Phase 3)

MINT can inspect the directory it was launched from, or the directory set with `MINT_WORKSPACE`. File changes are approval-gated; restricted terminal commands require a preview and explicit `/run` approval.

Commands:

- `/workspace` — show the active workspace root
- `/capabilities` — show capabilities actually registered in this harness
- `/ls [path]` — list a directory relative to the workspace
- `/read <path>` — read a text file relative to the workspace
- `/search <text>` — search text files in the workspace

The tools reject paths outside the workspace, refuse symlinks that resolve outside it, cap file/output sizes, and skip common generated directories and sensitive files such as `.env` and private-key files. These safeguards are defense-in-depth, not a substitute for reviewing tool behavior.

## Controlled file editing (Phase 4)

MINT supports targeted exact-text patch proposals for small edits and a full-file replacement workflow for larger rewrites:

1. Run `/propose relative/path.ext`.
2. Send the complete replacement content in the next message (use Shift+Enter for multiple lines).
3. Review the preview shown by MINT.
4. Type `/apply` to approve or `/reject` to discard. `/cancel-write` cancels input or discards the current proposal.

MINT does not write the target file while preparing the preview. It rejects sensitive filenames, unrecognized/binary file types, paths outside the workspace, symlink targets, and oversized content. Before applying, it checks whether the original file changed since preview. Restricted terminal commands require a preview and explicit `/run` approval. Review every diff carefully before approving it.

Set a workspace before launch, for example:

```bash
MINT_WORKSPACE="$HOME/Projects/my-app" bun run dev
```


## Harness-aware agent tools

MINT now derives its system instructions from the same capability registry that controls model-callable tools. Use `/capabilities` to inspect what this running instance actually exposes. The model can call the registered workspace tools during a turn, receive their results, and then answer. Unknown tools are rejected. File changes remain proposals until the user explicitly approves them with `/apply`.

The NVIDIA model/API must support OpenAI-compatible streamed function/tool calls for automatic tool use to work. If the selected model or endpoint rejects the `tools` field, MINT reports the API error rather than pretending the tool ran. The agent loop defaults to 12 tool rounds and 24 total tool calls per user turn, configurable with `MINT_MAX_TOOL_ROUNDS` and `MINT_MAX_TOOL_CALLS_PER_TURN`. Counters reset for each new user message. Stable repeated calls are detected only when both the arguments and returned result remain unchanged; changed results are allowed through. Internet browsing, unrestricted local-file access, and external integrations are not implemented.


## Project understanding and patch-based edits

Use `/project` to inspect common manifests, README/AGENTS documentation, and the root `.gitignore`. The agent can call `workspace_project_context` when it needs project conventions. Workspace listing/search respects common `.gitignore` patterns alongside built-in exclusions for generated and sensitive files.

For a small change, the model can use `workspace_propose_patch` with exact `find` and `replace` strings. Each `find` must match exactly once; ambiguous or stale patches are rejected. The result is only a proposal until `/apply` is explicitly entered. Larger rewrites may still use `workspace_propose_write`.

## Approved terminal commands

`/command bun run typecheck` creates a preview without executing it. Inspect the executable/arguments, workspace-relative directory, and timeout; then type `/run` to approve the single-use proposal or `/reject-command` to discard it. The agent's `terminal_propose` tool follows the same flow and cannot self-approve. Only registered executables are allowed, shell operators and redirection are blocked, and execution is capped at 120 seconds with bounded output. This is a safety layer, not a sandbox: approved package scripts and build tools can still perform consequential operations.

## Windows checks

```powershell
bun install
bun run check:windows
```

The PowerShell check script runs TypeScript type-checking first and stops if it fails, then runs the Bun test suite.


## Interactive ASCII cat

MINT has a classic, plain-ASCII sitting cat in the workspace sidebar. Its face changes with the selected expression and current mood; the mascot uses only standard ASCII characters for consistent rendering across terminal fonts. Click the cat (when terminal mouse reporting is supported), press `F2`, or type `/cat` to open its menu. Use Up/Down and Enter to choose an action; Escape closes the menu. The menu supports petting, feeding a virtual treat, choosing an unlocked expression, and toggling idle animations.

- `/pet` — pet MINT and increment the persistent pet counter.
- `/feed` — give MINT a virtual treat.
- `/expressions` — list expressions and unlock requirements.
- `/expression <id>` — equip an unlocked expression (`idle`, `happy`, `love`, `zoomies`, `wizard`, or `chaos`).

Heart eyes unlock after 3 pets; zoomies after 3 treats; the tiny wizard after 8 pets and 5 treats; and chaos gremlin after 15 pets and 10 treats. Pet/treat counts, unlocked expressions, the selected expression, and the animation preference are stored in MINT's existing SQLite database at `~/.mint/mint.sqlite` (or under `MINT_DATA_DIR`). The cat reacts to thinking, successful completion, errors, and approved command results. All rewards are cosmetic and local; there are no purchases or network calls for cat interactions.
