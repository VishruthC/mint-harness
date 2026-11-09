# MINT Cat — Asset Packs

The MINT cat companion renders real PNG images inside the terminal. All artwork
lives here as **asset packs** — you can replace the entire cat without editing
any TypeScript.

```text
src/cat/assets/
├── README.md        ← this file
└── default/         ← the one cat pack
    ├── manifest.json
    ├── idle/frame-01.png, frame-02.png
    ├── think/frame-01.png, frame-02.png
    ├── talk/frame-01.png … frame-04.png
    ├── read/frame-01.png, frame-02.png
    ├── write/frame-01.png, frame-02.png
    ├── tool/frame-01.png, frame-02.png
    ├── success/frame-01.png, frame-02.png
    ├── failure/frame-01.png, frame-02.png
    └── hi/frame-01.png, frame-02.png
```

Restart MINT after touching any frame or manifest — packs load at startup.

## 1. Where images are stored

One directory per pack under `src/cat/assets/`. The active pack is chosen with
`MINT_CAT_ASSET_PACK` in `.env` (default `default`). Every frame path in a
manifest is **relative to its pack directory** — never to your workspace, so
`minth` works from any directory.

## 2. Required PNG dimensions

`manifest.json` declares `dimensions: { width, height }` (shipped packs are
`128 × 128`). Keep every frame in a pack at exactly that size — frames with
different sizes are skipped with the idle fallback.

## 3. Transparency requirements

Frames must be **RGBA PNGs with a real alpha channel**. Mint's shipped cat
bakes its background to the harness color `#1E1E2E` so the image blends with
the Mint background in every terminal (some terminals render transparent
pixels as black). If you supply transparent frames they render as-is;
swap the transparency to `#1E1E2E` if you see black edges in your terminal.

## 4. Frame naming

States: `hi`, `idle`, `think`, `talk`, `read`, `write`, `tool`, `success`,
`failure`. Each state is a folder named after the state containing PNGs.
Names are free-form (`frame-01.png`, `idle_blink.png`, …) — the manifest is
the source of truth, not the filesystem.

## 5. Replacing an existing image

Overwrite the file with your own PNG of the same name and size, then restart
Mint. Nothing else changes.

## 6. Adding animation frames

1. Drop the new PNG into the state folder (e.g. `idle/frame-03.png`).
2. Add `"idle/frame-03.png"` to that state's `frames` array in `manifest.json`,
   in the order you want them to play.
3. Restart Mint.

## 7. Removing animation frames

Delete (or rename) the file referenced in the manifest, or edit the manifest
to stop referencing it. A referenced-but-missing file is dropped automatically.

## 8. Creating a second pack

Copy the pack, replace the PNGs, edit `name` in the manifest, and point
`MINT_CAT_ASSET_PACK` at the new directory name in `.env`:

```
mkdir src/cat/assets/my-cat
cp src/cat/assets/default/manifest.json src/cat/assets/my-cat/
cp -r src/cat/assets/default/* src/cat/assets/my-cat/
```

Every pack uses the same engine; a pack that fails validation is ignored and
Mint falls back to the built-in pixel cat.

You can point `MINT_CAT_ASSETS` at another directory to manage packs outside
the source tree.

## 10. Configuring animation FPS

Per state in `manifest.json`: `"fps": 3`. Loop with `"loop": true`, or play
once and hold with `"loop": false` plus `"holdMs": 2200`. `MINT_CAT_IDLE_FPS`
/ `MINT_CAT_WORKING_FPS` in `.env` override the idle / talk-read-write-tool
rates when set (> 0). `MINT_CAT_ANIMATION=0` freezes every state on frame 1.

## 11. Image asset pipeline (`bun run cat:assets`)

Process artwork from `incoming/` into manifest-conformant frames with sharp on
Bun — no Python, no manual resizing. Incoming artwork is **never modified**,
existing processed frames are **never overwritten without `--force`**, and
manifests are read-only.

### Where to put new artwork

Drop PNGs into `src/cat/assets/default/incoming/<state>/` (one folder per
animation state, e.g. `incoming/idle/`). Names are arbitrary — frames are
processed in sorted order. Any new state folder must also exist in
`manifest.json`.

### Commands

```powershell
bun run cat:assets                                   # all packs/states
bun run cat:assets -- --pack default                 # one pack
bun run cat:assets -- --pack default --state idle    # one state
bun run cat:assets -- --check                        # validate without writing
bun run cat:assets -- --pack default --state idle --force  # replace existing outputs
bun run cat:assets -- --background none              # keep transparency
```

### How processing works

Each input is fitted (preserved aspect ratio, never stretched) into the
`manifest.json` canvas (128×128), centered, and written as `frame-01.png`,
`frame-02.png`, … into the pack's processed `<state>/` directory — ready to
reference from the manifest.

- **Background**: transparent pixels are composited onto `#1E1E2E` (the Mint
  harness background) by default. `--background "#RRGGBB"` recolors it, and
  `--background none` keeps the alpha channel. Per-pack defaults live in
  `pipeline.json` (see guide below).
- **Resampling**: `nearest` (crisp pixel-art edges) by default; select `linear`
  or `lanczos3` in `pipeline.json` for smooth art.
- **Alignment/scale**: `alignX`/`alignY` (`start|center|end`), and per-state or
  per-frame `scale`/`dx`/`dy` overrides when frames have different subject
  sizes — two same-sized frames don't always have the same cat.

Example `src/cat/assets/default/pipeline.json`:

```json
{
  "background": "#1E1E2E",
  "kernel": "nearest",
  "states": { "idle": { "scale": 1.2 } },
  "frames": { "idle/art-a.png": { "dy": -6 } }
}
```

### Example: adding an idle frame

```powershell
copy my-new-idle.png src\cat\assets\default\incoming\idle\
bun run cat:assets -- --pack default --state idle --force
```

Then add the new processed frame to the `idle` array in `manifest.json` and
restart Mint. Remove the frame by deleting its `frames` entry (the file is
left harmlessly on disk).

### Troubleshooting common errors

- **`no incoming frames for state "x"`** — the state folder doesn't exist yet
  (`src/cat/assets/default/incoming/x/`); create it and drop PNGs in.
- **`invalid manifest.json / pipeline.json`** — fix the JSON; the error names
  the offending key.
- **`duplicate frame name`** — two files differ only by case (`A.png`, `a.png`)
  and collide on Windows/macOS. Rename one.
- **`exists; pass --force`** — an output frame already exists; it's yours —
  use `--force` to replace it, or edit the incoming source first.
- **`DIMxDIM, expected 128x128`** (from `--check`) — a processed frame no
  longer matches the manifest canvas. Rebuild it via the pipeline with
  `--force`, or update `dimensions` in `manifest.json` if you changed the
  canvas size.

## 11. Troubleshooting invalid images

- **Cat missing entirely**: check `MINT_CAT_ENABLED` (must be `1`), that the
  pack directory has a valid `manifest.json`, and that at least one frame file
  exists. Invalid packs warn and fall back; verify the path in `.env`.
- **One state stuck on idle**: that state's frames are absent from the
  manifest or the files are missing — idle is the documented fallback.
- **Cat looks squashed/stretched**: dimensions differ between frames or from
  the manifest. Match them exactly.
- **Blocky or huge cat**: tune `MINT_CAT_SCALE` (`0.5`–`3`).

## 12. Checking terminal image support

Mint negotiates the renderer with your terminal: **Kitty graphics**, then
**Sixel**, then **blocks** (real PNG rasterized into subcells). iTerm2 emits
are not emitted by OpenTUI — it uses blocks there. tmux keeps the detected
outer-terminal renderer where your tmux forwards graphics queries; zellij/
screen fall back to blocks.

- `MINT_CAT_RENDERER=kitty` forces Kitty graphics.
- `MINT_CAT_RENDERER=sixel` forces Sixel.
- `MINT_CAT_RENDERER=blocks` forces subcell rasterization.
- `MINT_CAT_RENDERER=ascii` forces the lightweight pixel fallback (no PNGs).

If the cat never shows and the divider renders bare, compare with
`MINT_CAT_RENDERER=blocks` — if that works, your terminal blocks graphics
queries but not blocks. 

## States & triggers

| State | Trigger |
| --- | --- |
| `hi` | Session start (once, then idle) |
| `idle` | Waiting for input (loops, occasional blink) |
| `think` | Model reasoning |
| `talk` | Response streaming |
| `read` | `workspace_read`/`workspace_search` executing |
| `write` | `workspace_propose_write`/`workspace_propose_patch` executing |
| `tool` | Other tools executing |
| `success` | Tool/response succeeded (one-shot, then idle) |
| `failure` | Tool/response failed (one-shot, then idle) |

Missing states fall back to `idle`; any new operation cancels a one-shot.
