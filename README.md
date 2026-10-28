# ✿ MINT

A cute, terminal-native coding harness inspired by OpenCode's architecture, independently implemented and **NVIDIA API-only**.

> Current milestone: Phase 4 — OpenTUI chat, NVIDIA NIM streaming, SQLite sessions, read-only workspace tools, and approval-gated full-file edits. Shell command execution is intentionally disabled.

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

In `.env`, set `NVIDIA_API_KEY` to your NVIDIA API key. Optionally set `NVIDIA_MODEL` to a model ID available to your account. Do not share or commit `.env`.

MINT uses `https://integrate.api.nvidia.com/v1` by default. Set `NVIDIA_MODEL` to a model ID you can access, or leave it blank and choose from the models returned by the API.

## Current commands

- `/help` — show available commands
- `/models` — refresh and list NVIDIA models
- `/model <id>` — select a model
- `/new` — start a new persistent session
- `/sessions` — list recent sessions
- `/resume <id>` — resume a saved session
- `/cancel` — cancel an in-progress response
- `/clear` — start a fresh session (old sessions remain saved)
- `/quit` — exit MINT
- `Shift+Enter` — insert a newline; `Enter` sends

No local-model or alternate-cloud-provider setup is included.

## Session storage

Conversation history is stored in SQLite at `~/.mint/mint.sqlite` by default. Set `MINT_DATA_DIR` to change the data directory. The directory is created with restrictive permissions and the database file is set to owner-only permissions where supported. Back up this file if you want to preserve sessions.

## Security notes

- Never commit `.env` or paste an API key into source code.
- This version reads the key from `NVIDIA_API_KEY`; OS credential-store integration remains a follow-up. Keep `.env` private and do not commit it.
- MINT can inspect workspace files and supports explicit approval-gated file replacement proposals.
- MINT does **not** execute shell commands. Review each proposed diff before typing `/apply`.

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

MINT can inspect the directory it was launched from, or the directory set with `MINT_WORKSPACE`. It does not write files or run shell commands.

Commands:

- `/workspace` — show the active workspace root
- `/ls [path]` — list a directory relative to the workspace
- `/read <path>` — read a text file relative to the workspace
- `/search <text>` — search text files in the workspace

The tools reject paths outside the workspace, refuse symlinks that resolve outside it, cap file/output sizes, and skip common generated directories and sensitive files such as `.env` and private-key files. These safeguards are defense-in-depth, not a substitute for reviewing tool behavior.

## Controlled file editing (Phase 4)

MINT supports an explicit full-file replacement workflow:

1. Run `/propose relative/path.ext`.
2. Send the complete replacement content in the next message (use Shift+Enter for multiple lines).
3. Review the preview shown by MINT.
4. Type `/apply` to approve or `/reject` to discard. `/cancel-write` cancels input or discards the current proposal.

MINT does not write the target file while preparing the preview. It rejects sensitive filenames, unrecognized/binary file types, paths outside the workspace, symlink targets, and oversized content. Before applying, it checks whether the original file changed since preview. Terminal command execution is still not implemented. Review every diff carefully before approving it.

Set a workspace before launch, for example:

```bash
MINT_WORKSPACE="$HOME/Projects/my-app" bun run dev
```
