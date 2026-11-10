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

`manifest.json` declares `dimensions: { width, height }` (the shipped canvas is
`128 × 128`). New frames should match that canvas; `bun run cat:assets --check`
reports mismatches. Existing frames may differ in size — the renderer fits them
into the cat box without stretching or cropping, so deliberate legacy artwork
keeps working.

## 3. Transparency requirements

Frames must be **RGBA PNGs with a real alpha channel**. Mint's shipped cat
bakes its background to the harness color `#1E1E2E`. MINT's chrome (header,
sidebar, chat, input) is transparent and inherits the terminal's own background,
but a baked background inside a frame remains visible in the image box — that is
expected, especially on light or custom terminal themes. If you supply frames
with real transparency they render as-is; use the pipeline's `--background none`
option for new artwork, or `#1E1E2E` when you want the default harness color.
Do not edit or rebuild the shipped frames just to change this.

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

## 9. Animation states, transitions and timing

### States

| State | Playback | What it represents |
| --- | --- | --- |
| `idle` | loop | Waiting for the user; subtle idle motion |
| `hi` | one-shot | Greeting at session start |
| `think` | loop | Model reasoning / request processing |
| `talk` | loop | Streaming a user-facing response |
| `read` | loop | `workspace_read` / `workspace_search` running |
| `write` | loop | `workspace_propose_write` / `workspace_propose_patch` running |
| `tool` | loop | Any other tool running (kept for pack compatibility) |
| `success` | one-shot | A tool or turn completed successfully |
| `failure` | one-shot | A tool or turn failed |

Frame counts are always read from each state's `frames` array. States may have
different counts (the shipped pack has 2 idle frames, 4 talk frames, and so on);
the animator never assumes a shared length.

### Event-to-state mapping

The mapper uses the real events already emitted by Mint:

| Mint event | Cat state |
| --- | --- |
| App start / `/new` | `hi` |
| Waiting for input, turn finished, resume | `idle` (underlying) |
| Request starts / next tool round | `think` |
| First streamed content in a round | `talk` |
| `workspace_read`, `workspace_search` | `read` |
| `workspace_propose_write`, `workspace_propose_patch` | `write` |
| Any other tool | `tool` |
| Tool result / final turn completion | `success` |
| Tool error / final turn failure | `failure` |
| `Ctrl+C` while busy | immediate `idle` |

### Priorities, interruptions and one-shots

One-shots are protected by a deterministic priority:

```text
failure > success > hi > think > read > write > tool > talk > idle
```

- A visible one-shot owns the screen until its full `holdMs` elapses.
- Lower-priority events (including looping activity) do **not** cut a one-shot
  short. They update the underlying state so the cat can resume there.
- A new `failure` interrupts any animation. `success` interrupts `hi` and
  looping work; `hi` interrupts looping work.
- Repeated identical events never restart the same animation.
- When a one-shot ends, the cat returns to the latest underlying working state
  it was told about (for example `think` or `talk`), or `idle` when the turn is
  over. It does not always snap to idle.
- Cancellation is an explicit user action, so it settles immediately to idle.

Looping states follow the latest real event. That is why a `think` animation can
transition to `talk` when content starts streaming even though `think` has a
higher interruption priority: the priority order only decides which one-shot
owns the screen.

### Transitions

Terminal image protocols (Kitty/Sixel/blocks) cannot crossfade two pictures, so
Mint does not fake a blend. On a state change it:

1. freezes the outgoing state's current frame,
2. waits `MINT_CAT_TRANSITION_MS` (default `100`, one animation tick),
3. draws the incoming state on its first frame at the next frame boundary.

The previous decoded image stays mounted while the next frame loads, so there
are no blank frames or flicker. Frames are decoded once per mount and cached;
in-flight reads are deduplicated, and the current or incoming state's frames are
prefetched one at a time so the first loop pass is as smooth as later passes.
A late decode only swaps in if its frame is still selected, so it can never
rewind a loop. Set `MINT_CAT_TRANSITION_MS=0` to switch immediately. The
animation clock is paused while the terminal is unfocused, and schedules no
interval when `MINT_CAT_ENABLED=0` or when the sidebar is hidden (terminal
narrower than 100 columns). Looping frame counts and FPS are read per state;
the animator never assumes every state has the same number of frames.

### Timing configuration

| Setting | Where | Meaning |
| --- | --- | --- |
| `fps` | `manifest.json` per state | Per-state frame rate (source of truth) |
| `loop` | `manifest.json` per state | `true` loops; `false` is a one-shot |
| `holdMs` | `manifest.json` per one-shot | On-screen duration of `hi`/`success`/`failure` |
| `MINT_CAT_IDLE_FPS` | `.env` | Overrides idle FPS when > 0 |
| `MINT_CAT_WORKING_FPS` | `.env` | Overrides talk/read/write/tool FPS when > 0 |
| `MINT_CAT_ONESHOT_SPEED` | `.env` | Multiplies one-shot frame playback (default `1`) |
| `MINT_CAT_TRANSITION_MS` | `.env` | Outgoing-frame hold before the incoming first frame |
| `MINT_CAT_ANIMATION` | `.env` | `0` freezes every state on frame 1 |
| `MINT_CAT_ENABLED` | `.env` | `0` hides the cat and stops the animation clock |

`MINT_CAT_ONESHOT_SPEED` changes frame playback only; `holdMs` still controls how
long a one-shot stays on screen. `think` keeps its manifest FPS; the working FPS
override applies to `talk`, `read`, `write` and `tool`, matching the previous
behavior.

## 10. Adding frames or states

### Add frames without changing TypeScript

1. Put the processed frame in the state folder, for example
   `src/cat/assets/default/idle/frame-03.png`.
2. Add its path to that state's `frames` array in `manifest.json`, in playback
   order.
3. Restart Mint.

Or use the pipeline: drop source PNGs in `incoming/<state>/`, run
`bun run cat:assets -- --pack default --state idle`, then add the processed
paths to `manifest.json`. Frames never need a code change.

### Add a new animation state

The renderer is generic, but the state name is part of the event-mapping types,
so a new state needs a few small code additions:

1. Add the name to `CAT_STATES` in `src/cat/types.ts`.
2. Give it a priority in `STATE_PRIORITY` (`src/cat/animator.ts`). If it is a
   one-shot, add it to `DEFAULT_ONE_SHOT_STATES` or set `"loop": false` in the
   manifest.
3. Add a folder + `frames`/`fps`/`loop`/`holdMs` entry in `manifest.json`.
4. Map a real Mint event to it in `stateFor` (`src/cat/state-mapper.ts`) and
   emit that event from `src/index.tsx`.
5. Add a mapper/animator test.

No widget or renderer changes are required, and frames can still be replaced
through the pipeline without editing code.

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
  `pipeline.json` (see below).
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

### Pipeline troubleshooting

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

## 12. Troubleshooting invalid images and animation

- **Cat missing entirely**: check `MINT_CAT_ENABLED` (must be `1`), that the
  pack directory has a valid `manifest.json`, and that at least one frame file
  exists. Invalid packs warn and fall back; verify the path in `.env`.
- **One state stuck on idle**: that state's frames are absent from the
  manifest or the files are missing — idle is the documented fallback.
- **Cat does not animate**: check `MINT_CAT_ANIMATION` is `1`, the state's
  `fps` is greater than `0`, and the state has at least two frames. A single
  frame is intentionally static.
- **Transitions feel slow or abrupt**: tune `MINT_CAT_TRANSITION_MS`. `0`
  switches on the next render; `100` holds one 100 ms animation tick.
- **One-shot too fast or too slow**: adjust `holdMs` in `manifest.json` for
  duration, or `MINT_CAT_ONESHOT_SPEED` for frame playback speed.
- **Working animation ignores `MINT_CAT_WORKING_FPS`**: that override applies
  to `talk`, `read`, `write` and `tool`; `think` uses its manifest `fps`.
- **Cat changes size between states**: frame dimensions differ from the
  manifest canvas. The renderer fits each frame into the same box, but matching
  the canvas keeps framing consistent. `bun run cat:assets -- --check` reports
  mismatches without writing.
- **Blocky or huge cat**: tune `MINT_CAT_SCALE` (`0.5`–`3`).

## 13. Checking terminal image support

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
