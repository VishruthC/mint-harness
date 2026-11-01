# MINT — Field Notes website

A single-page field guide to [MINT](https://github.com/VishruthC/mint-harness), the terminal-native coding harness for NVIDIA models. Warm paper, editorial type, Catppuccin terminal exhibits, and one canvas cat.

The site is intentionally static. There is no framework, no analytics, no cookies, and no API calls at runtime.

## Stack

- **Vite 8** + **TypeScript**
- **GSAP / ScrollTrigger** for the pinned loop and approval scenes
- Plain DOM modules for everything else
- **Newsreader** and **Victor Mono** via Fontsource
- **Departure Mono** self-hosted in `src/assets/fonts/` (OFL; license also in `public/fonts/`)

## Scripts

Run from `website/`:

```bash
bun install
bun run dev       # local dev server
bun run typecheck # tsc --noEmit
bun run build     # static production build in dist/
bun run preview   # preview the production build
```

## Structure

```
website/
├─ index.html                 # all page content and section hooks
├─ public/                    # favicon, robots, sitemap, OG image, font license
├─ src/
│  ├─ main.ts                 # entry point; initializes each feature
│  ├─ features/               # hero, loop, approval, command, sessions, cat, install, index
│  ├─ lib/                    # cat canvas view, GSAP setup, page motion, toast, DOM helpers
│  └─ styles/                 # tokens, base, layout, sections, motion
└─ vite.config.ts             # base path and cat renderer alias
```

## Content sources

The page only describes features that exist in the harness. Sources of truth:

- `../README.md` — capabilities, limits, install requirements, cat commands
- `../docs/ROADMAP.md` — what is shipped vs. not yet
- `../src/cat.ts` — expression names and unlock thresholds
- `../src/agent-loop.ts`, `../src/agent-tools.ts` — loop and tool behavior
- `../src/terminal.ts` — command allowlist and timeout
- `../src/storage.ts` — SQLite session behavior

No invented metrics, testimonials, customer logos, or fake benchmark numbers are used.

## Demos are labeled

Several interactions are scripted demonstrations, not live harness calls:

- The hero TUI replay is a scripted turn. It makes no API calls.
- The approval desk `/apply` keycap is a demo. It changes no files.
- The `/run` command demo is illustrative. It executes nothing.
- The session cards are illustrative. The real store is local SQLite.
- The cat playground runs locally in the browser and persists pets, treats, and unlocks in `localStorage`. The real harness stores them in SQLite.

Each of these is labeled in the page copy or in the toast shown when it is used.

## The cat renderer

The site imports the harness renderer directly from `../src/cat-art.ts` through the `@mint/cat-art` Vite alias, so there is no second copy of the drawing code.

An earlier harness renderer had two geometry bugs that erased most of the portrait: the body radius multiplied by `size` twice, and the ellipse outline smoothstep was inverted. Both are fixed in the current renderer, so the website imports it directly with no build-time patch. `src/lib/cat-view.ts` crops the 192px plate to the cat's measured bounds and scales it to the display canvas.

The cat animation is throttled to the harness's 12 fps cadence and stops when the canvas is offscreen or the document is hidden. With `prefers-reduced-motion: reduce`, it renders a single static frame.

## Accessibility

- Semantic landmarks, skip link, visible focus rings
- Keyboard-navigable tabs, index dialog, and expression controls
- `aria-live` status messages for the cat and demos
- Full `prefers-reduced-motion: reduce` path: no pinned scenes, no autoplay, static cat frame
- Responsive from 320px through wide desktop
- No horizontal overflow at tested widths

## Deploy

The site deploys to GitHub Pages at:

```
https://vishruthc.github.io/mint-harness/
```

The workflow is `.github/workflows/deploy-website.yml`. It builds `website/` with Bun and publishes `website/dist` using the official Pages actions. The Vite base path is `/mint-harness/` when `GITHUB_ACTIONS` is set.

To enable it in a fork:

1. Push the workflow to the default branch.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Run the **Deploy website** workflow, or push a change under `website/`.

For a different base path, set `VITE_BASE` when building:

```bash
VITE_BASE=/my-repo/ bun run build
```

## License

The website source is part of the MINT repository and is MIT licensed. Departure Mono is licensed under the SIL Open Font License; see `public/fonts/DEPARTURE-MONO-LICENSE.txt`.
