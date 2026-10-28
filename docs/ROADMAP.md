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
- [ ] Better scroll behavior
- [ ] OS credential-store integration
- [ ] Model picker UI
- [ ] Better errors and retry behavior

## Milestone 3 — Read-only coding-agent foundation
- [x] Workspace-aware file listing
- [x] File read tool with size limits
- [x] Text search with result limits
- [x] Workspace path boundary checks
- [x] Exclude common generated directories and sensitive environment/key files
- [x] Reject symlinks that resolve outside the workspace
- [ ] Add an NVIDIA tool-call/agent loop and model capability checks
- [ ] Add tool registry schemas and tool-call/result conversation handling
- [ ] Add focused tests and verify on the target machine

## Milestone 4 — Controlled file editing
- [x] Full-file replacement proposal flow via `/propose <path>`
- [x] Diff-like preview before applying changes
- [x] Explicit `/apply` approval and `/reject` discard
- [x] `/cancel-write` for pending content/proposal
- [x] Revalidate path and file hash before applying
- [x] Tests for rejected/stale proposals and sensitive/out-of-root paths
- [ ] Patch-based targeted edits rather than full-file replacement
- [ ] Preserve existing file permissions on replacement
- [ ] Run tests and type-check on Windows

Note: this milestone adds manually initiated file proposals. NVIDIA-driven automatic tool calling is still a separate task and must not bypass these approval gates.

## Milestone 5 — Approved terminal commands
- [ ] Exact command and working directory preview
- [ ] Explicit approval before execution
- [ ] Timeouts, output limits, and cancellation
- [ ] Exit-code and stderr/stdout reporting
- [ ] Command restrictions and dangerous-command protections

## Milestone 6 — Project understanding
- [ ] Respect `.gitignore` and MINT exclusions
- [ ] Detect project type and language
- [ ] Discover manifests, README files, and configuration
- [ ] Bounded, request-focused context assembly
- [ ] Optional refreshable project summaries

## Milestone 7 — Agent orchestration
- [ ] Multi-step task planning and tool selection
- [ ] Configurable iteration and token limits
- [ ] Detect repeated/unproductive tool calls
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
