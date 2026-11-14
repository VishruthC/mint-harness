# Changelog

All notable changes to MINT are documented here. This project follows
[Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3] - 2026-11-13

### Fixed

- The `/` command palette now keeps the complete command list and scrolls a
  visible window instead of silently truncating to the first seven entries.
  The header shows the current range, and `/help` is generated from the same
  command list so both surfaces stay in sync.
- Added missing palette entries for `/new`, `/exit`, `/approve`, `/autoapply`,
  and `/reject-command`.
- Model picker search now matches natural names regardless of punctuation,
  casing, or spacing, so `Llama 3.1 8B` finds `meta/llama-3.1-8b-instruct`.
  Exact and prefix matches sort first, and the search row no longer overlaps
  the picker header. Pasted model names are routed into the filter.
- The model picker filter now updates the visible rows immediately while
  typing. The list was previously keyed by numeric window positions, so the
  header count changed while the old model names stayed on screen. `/model`
  now opens the full catalog sorted alphabetically by display name, highlights
  the current model, and searches display names, IDs, and providers.
- Slash-command filtering now updates the visible rows immediately for the same
  reason. Command autocomplete and the model picker also scroll only when the
  highlighted row reaches the complete top or bottom edge, so the list stays
  still while the selection remains visible.
- Wheeling over the chat or session sidebar while the command palette or model
  picker is open now scrolls only the menu; the background stays put.

### Changed

- The `minth` launcher now starts Bun in the directory the user invoked it from,
  passing the OpenTUI Solid preload (and source tsconfig) by absolute path.
  This leaves the installed package directory unlocked, so `/update` can replace
  it on Windows. Windows users on `0.1.2` need one manual
  `npm install -g mint-harness@latest` to get this launcher; later updates work
  from `/update`.

## [0.1.2] - 2026-11-13

### Fixed

- Terminal bracketed paste now reaches the `/connect` API-key field instead of
  being discarded while the connect popup is open.
- Sidebar cat frames now trim baked-in or transparent margins in memory,
  share one crop box per animation to avoid frame-to-frame pulsing, and use the
  full sidebar width. This makes the artwork noticeably sharper in terminals
  that render images with Unicode blocks instead of Kitty or Sixel.

## [0.1.1] - 2026-11-12

### Added

- Background npm update checks at startup. Checks are stable-only, memoized,
  silent on failure, and notify once per version without blocking the UI.
- `/update` command with a fresh registry check, installed/latest versions,
  explicit confirmation, and a real `npm install -g mint-harness@latest` run.
- `/version` command showing the installed version, latest known stable version,
  update status, and any pending restart.
- Update confirmation using the existing approval queue and panel, with
  `Yes, update` and `Cancel` actions.
- Notification state at `~/.mint/update-state.json` (or
  `$MINT_DATA_DIR/update-state.json`), separate from credentials, `.env`,
  sessions, and history.

### Security

- MINT never installs an update without explicit confirmation and never restarts
  itself.
- Updates never use `sudo` or a shell; npm receives a fixed argv array.
- The npm child process receives a secret-filtered environment, and captured
  npm output is stripped of terminal control sequences and redacted before it is
  shown.
- Updating does not modify the user's NVIDIA credentials, configuration,
  sessions, history, or cat artwork.

### Changed

- The approval queue now handles update requests alongside file-apply and
  terminal-command approvals, including out-of-order resolution and stale
  request cleanup.

### Fixed

- Installed-version resolution now works from both the source tree and the
  packaged `dist/` bundle on Windows and Linux.

### Documentation

- Added update and version commands to the README, plus update safety and
  troubleshooting notes.

## [0.1.0] - 2026-11-12

### Added

- Initial public npm release.
- Interactive OpenTUI chat with NVIDIA NIM streaming.
- SQLite-backed sessions scoped to the launch workspace.
- Model-callable workspace tools with targeted patch proposals.
- Explicit approval flows for file changes and restricted terminal commands.
- Project-context discovery, model picker, usage limits, and the animated cat
  companion.

[0.1.3]: https://github.com/VishruthC/mint-harness/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/VishruthC/mint-harness/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/VishruthC/mint-harness/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/VishruthC/mint-harness/releases/tag/v0.1.0
