# MINT

A cute, terminal-native coding harness inspired by OpenCode's architecture, independently implemented and **NVIDIA API-only**.

> Interactive OpenTUI chat with NVIDIA NIM streaming, SQLite sessions, model-callable workspace tools, targeted patch proposals, project-context discovery, approval-gated restricted terminal commands, in-app npm update checks, repeated-tool-loop safeguards, and an animated cat companion. Web browsing is not implemented.

## Requirements

- **Bun >= 1.3.14** (required at runtime, even when installed via npm; see OpenTUI runtime requirements)
- An **NVIDIA API key** with access to at least one hosted model
- A supported terminal (Linux x64, macOS, or Windows x64/WSL; see OpenTUI platform support)

## Install (npm)

```bash
npm install -g mint-harness
```

Then run MINT from the directory you want it to work in:

```bash
cd ~/Projects/my-app
minth
```

MINT uses the directory you launch it from as the workspace and only shows sessions created in that exact directory. Session data is stored in `~/.mint/mint.sqlite` by default (set `MINT_DATA_DIR` to override).

> **Note:** npm installs ship a prebuilt Bun bundle (`dist/index.js`) alongside the source and cat assets, so JSX/Solid transforms are already applied. Make sure `bun` is installed and available on your `PATH`. The launcher runs from the package root for dependency resolution but preserves your launch directory as the workspace and `.env` location.

## Updates

Added in **0.1.1**. MINT checks the npm registry for a newer stable release in the background when it starts. The check never blocks the UI or chat input and fails silently when the network is unavailable. When a new version is available, MINT shows a small banner once per version. The last-notified version is stored separately in `~/.mint/update-state.json` (or under `MINT_DATA_DIR`) and never touches your API keys, `.env`, sessions, or history.

- `/update` performs a fresh registry check, shows the installed and latest stable versions, and asks for explicit confirmation before running `npm install -g mint-harness@latest`.
- `/version` shows the installed version, the latest known stable npm version, and whether an update is available.
- MINT never installs an update without confirmation, never elevates privileges, and never restarts itself. After a successful update, exit and relaunch MINT to use the new version.
- Updating requires a working `npm` on your `PATH` with permission to write to your global npm prefix.

## Configure

Set your NVIDIA credentials in the environment or in a `.env` file in the directory where you launch `minth` (or use the in-app `/connect` flow):

```dotenv
# Required
NVIDIA_API_KEY=

# Optional
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=

# Agent safety limits (positive integers)
MINT_MAX_TOOL_ROUNDS=12
MINT_MAX_TOOL_CALLS_PER_TURN=24

# Effort level hint (low, medium, high, max; default max)
MINT_EFFORT=max
```

MINT uses `https://integrate.api.nvidia.com/v1` by default. Set `NVIDIA_MODEL` to a model ID you can access, or leave it blank and choose from the models returned by the API. **Changes to `.env` require restarting MINT.** Do not share or commit `.env`.

## Run from source (development)

```bash
git clone https://github.com/VishruthC/mint-harness.git
cd mint-harness
bun install
cp .env.example .env
# edit .env and set NVIDIA_API_KEY
bun run dev
```

You can also create a local launcher in the source checkout with `bun run install:minth`, or point the workspace explicitly with `MINT_WORKSPACE="$HOME/Projects/my-app" bun run dev`.

## Commands

- `/help` - show available commands
- `/update` - check npm and install the latest stable release after confirmation
- `/version` - show the installed version and update status
- `/models` - refresh the catalog and open the model picker
- `/model` - open the model picker; type a model name to filter
- `/model <id>` - select a model directly (persists to `.env`)
- `/retry` - retry the last user message
- `/connect` - configure NVIDIA API credentials (opens secure popup)
- `/session` - list or resume sessions (interactive picker)
- `/sessions` - list or resume sessions (alias)
- `/session new` - start a fresh session
- `/new` - start a fresh session (alias)
- `/session delete <id>` - delete a session
- `/session rename` - rename active session (opens popup)
- `/session rename <name>` - rename active session directly
- `/limits` - show current agent limits (rounds/calls) and config keys
- `/workspace` - show the active workspace root
- `/capabilities` - show capabilities actually registered in this harness
- `/project` - inspect project context (manifests, docs, .gitignore)
- `/ls [path]` - list a directory relative to the workspace
- `/read <path>` - read a text file relative to the workspace
- `/search <text>` - search text files in the workspace
- `/propose <path>` - propose a file replacement (then send full content)
- `/apply` / `/reject` - approve or discard a pending file proposal
- `/approve` - approve the current pending file change or command
- `/autoapply` - show or change auto-apply mode (`on`, `off`, `status`, `save`)
- `/cancel-write` - cancel write input or discard the current proposal
- `/command <cmd>` - propose an allowlisted terminal command
- `/run` / `/reject-command` - approve or discard a pending command
- `/cancel` - cancel an in-progress response
- `/clear` - start a fresh session (old sessions remain saved)
- `/quit` - exit MINT
- `/exit` - exit MINT (alias)
- `Shift+Enter` - insert a newline; `Enter` sends

## Mouse & keyboard

- **Popups/menus:** click outside to close, click items/buttons to act, wheel scrolls lists. Keyboard equivalents: arrows, Enter, Esc, PgUp/PgDn, Home/End, Tab.
- **Clipboard:** `Ctrl+Shift+V` / `Ctrl+V` / `Shift+Insert` to paste; `Ctrl+Shift+C` to copy selection; `Ctrl+C` copies selection if present, otherwise aborts/exits. Mouse selection auto-copies on release.

## Security notes

- Never commit `.env` or paste an API key into source code. `/connect` masks the key and validates before writing to `.env`.
- MINT derives its system prompt and model-callable tools from the active capability registry. The model can propose file changes and terminal commands, but writes require explicit `/apply` and commands require explicit `/run`.
- Workspace tools reject paths outside the workspace, refuse symlinks that resolve outside it, cap sizes, and skip common generated/sensitive files (e.g. `.env`, private keys). These safeguards are defense-in-depth; review proposals before approving.
- Terminal commands are allowlisted, previewed (cwd/timeout), and single-use on approval. Shell operators/redirection are blocked, but approved commands/scripts can still have side effects—inspect every preview.

## Session storage

Conversation history is stored in SQLite at `~/.mint/mint.sqlite` by default. Set `MINT_DATA_DIR` to change the data directory. Each session stores its model selection and is scoped to the workspace directory it was created in.

## Windows checks (source)

```powershell
bun install
bun run check:windows
```

## Changelog

Release notes are in [CHANGELOG.md](./CHANGELOG.md).

## References

- OpenTUI docs: https://opentui.com/docs/
- OpenTUI runtime support: https://opentui.com/docs/getting-started/runtime-support/
- NVIDIA NIM LLM APIs: https://docs.api.nvidia.com/nim/reference/llm-apis

## License

MIT — see [LICENSE](./LICENSE).
