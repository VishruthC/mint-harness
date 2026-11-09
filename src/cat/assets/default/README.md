# MINT Cat — default pack

The shipped MINT Cat: muted lavender body, peach eyes, grey-lavender outline —
tuned to sit natively on Mint's dark theme.

- Frames: 128×128 transparent PNGs, one folder per state (`idle`, `think`, `talk`, `read`, `write`, `tool`, `success`, `failure`, `hi`).
- Frames are the source of truth: add/remove by editing `manifest.json` (paths are pack-relative), then restart Mint.
- Regenerate the reference set any time with `bun scripts/generate-cat-assets.ts`.
- Full guide: [`README.md`](../README.md).
