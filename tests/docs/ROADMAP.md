# MINT roadmap

## Milestone 1 — NVIDIA chat vertical slice
- [x] Bun + TypeScript project scaffold
- [x] OpenTUI + SolidJS shell
- [x] NVIDIA `/v1/models` client
- [x] Streaming `/v1/chat/completions` client
- [x] Chat UI and basic slash commands
- [x] API key from environment
- [ ] Run on target machine and fix runtime/API compatibility issues

## Milestone 2 — Usability and persistence
- [x] SQLite sessions and resume
- [x] Request cancellation
- [x] Basic multiline input
- [x] Bounded message viewport and Page Up/Page Down scrolling
- [ ] OS credential-store integration
- [x] Filterable `/model` suggestions
- [x] Actionable API errors and `/retry`

## Milestone 3 — Read-only coding-agent foundation
- [x] Workspace-aware file listing
- [x] File read tool with size limits
- [x] Text search with result limits
- [x] Workspace path boundary checks
- [x] Exclude common generated directories and sensitive environment/key files
- [x] Reject symlinks that resolve outside the workspace
- [x] Add an NVIDIA tool-call/agent loop and model capability checks
- [x] Add tool registry schemas and tool-call/result conversation handling
- [x] Add focused tests for tool-call parsing and capability discovery
- [ ] Verify on the target machine

## Milestone 4 — Controlled file editing
- [x] Full-file replacement proposal flow via `/propose <path>`
- [x] Diff-like preview before applying changes
- [x] Explicit `/apply` approval and `/reject` discard
- [x] `/cancel-write` for pending content/proposal
- [x] Revalidate path and file hash before applying
- [x] Tests for rejected/stale proposals and sensitive/out-of-root paths
- [x] Patch-based targeted edits rather than full-file replacement
- [x] Preserve existing file permissions on replacement
- [x] Windows PowerShell check script for type-check and tests (must be run on target Windows machine)

Note: model-driven tool calling can request file proposals, but it cannot bypass the explicit approval gate. Terminal command execution remains a separate milestone.

## Milestone 5 — Approved terminal commands
- [x] Exact command and working directory preview
- [x] Explicit approval before execution
- [x] Timeouts and output limits; cancellation still needs a dedicated process-kill path
- [x] Exit-code and stderr/stdout reporting
- [x] Command allowlist and shell-operator restrictions (defense-in-depth, not a sandbox)

## Milestone 6 — Project understanding
- [x] Respect common `.gitignore` patterns and MINT exclusions
- [x] Detect common project types and languages
- [x] Discover common manifests, README/AGENTS files, and configuration
- [x] Bounded project-context summary
- [ ] Optional refreshable project summaries

## Milestone 7 — Agent orchestration
- [ ] Multi-step task planning and tool selection
- [ ] Configurable iteration and token limits
- [x] Suppress repeated identical tool calls and cap calls per turn
- [ ] Progress reporting, cancellation, and recovery
- [ ] User checkpoints for ambiguous/high-impact tasks

## Milestone 8 — Conversation and session experience
- [ ] Searchable session history
- [ ] Export sessions to Markdown/JSON
- [ ] Validated import of MINT exports
- [ ] Context compaction/summarization
- [ ] Database migrations and backup guidance

## Milestone 9 — Terminal UX
- [ ] Reliable multiline input and keyboard shortcuts
- [ ] Tool activity indicators and clear error states
- [ ] Configurable UI preferences
- [ ] Graceful resize and shutdown handling
- [ ] Diagnostics with secret redaction

## Milestone 10 — Configuration and credential safety
- [ ] Secure configuration and workspace settings
- [ ] Never log API keys or authorization headers
- [ ] Optional OS credential-store integration
- [ ] Safe config validation and migration

## Milestone 11 — Reliability and security
- [ ] Unit and integration tests with mocked NVIDIA responses
- [ ] Path traversal, symlink, and approval-gate tests
- [ ] Cancellation, streaming, and API error tests
- [ ] SQLite migration/recovery tests
- [ ] Dependency/build checks
- [ ] Opt-in live NVIDIA integration tests

## Milestone 12 — Packaging and release
- [ ] Production build and launch workflow
- [ ] First-run configuration experience
- [ ] Supported OS installation docs
- [ ] Version reporting and changelog
- [ ] Upgrade/migration documentation
- [ ] Security review before production-ready claims


## Milestone 13 — Interactive ASCII cat
- [x] Plain-ASCII terminal cat with lightweight idle animation
- [x] Menu opened by mouse click where supported, F2, or `/cat`
- [x] Pet/feed actions and persistent progress
- [x] Unlockable expressions and expression picker
- [x] Toggle animations and react to agent success/error states
- [x] Unit tests for unlock progression and expression selection
- [ ] Verify mouse event behavior and visual layout on target terminals
