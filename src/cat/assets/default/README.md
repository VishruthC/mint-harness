# MINT Cat — default pack

The shipped MINT Cat: muted lavender body, peach eyes, grey-lavender outline —
tuned to sit natively on Mint's dark theme.

- Manifest canvas: 128×128. Existing frames are user-owned artwork; the renderer scales frames that differ from the manifest canvas.
- Frames use RGBA PNGs with the background baked to the `#1E1E2E` harness color, one folder per state (`idle`, `think`, `talk`, `read`, `write`, `tool`, `success`, `failure`, `hi`).
- These frames are final, user-owned artwork. Do not regenerate or overwrite them; add new frames through `incoming/` and `bun run cat:assets`.
- `manifest.json` is the source of truth for playback order, FPS and one-shot holds. Paths are pack-relative.
- Full guide: [`README.md`](../README.md).
