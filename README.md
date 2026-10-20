# OM Record Analyzer

A web tool for analyzing **Opus Magnum** (a Zachtronics puzzle game) records. It fetches leaderboard data from the community API and renders interactive Pareto frontier charts, with local browser-based solution verification powered by WebAssembly.

[中文说明](./README.zh.md)

## Features

- **Pareto Frontier Visualization** — interactive 2D scatter plots comparing any two metrics (cost, cycles, area, instructions, height, width, bounding hex, rate, and their `@∞` variants) for a selected puzzle. Supports log/linear scales, drag-to-zoom, overlap/trackless/looping filters, and multi-manifold frontier computation. Settings are grouped in a collapsible left panel, opening as an overlay when chart space is limited.
- **Records Sorting** — independent O → T → L flag priority ahead of the numeric metric chain. T and L default off and cycle through true-first, false-first, then off; settings persist across reloads.
- **Local Solution Verification** — upload `.solution` files (exported Opus Magnum saves) and verify them entirely in the browser via a compiled WebAssembly engine. Scores are computed locally — no server-side simulation.
- **Frontier Detection** — your verified solutions are overlaid on the leaderboard chart and classified as "on frontier" (green) or "off frontier" (red). After upload, the sidebar lists exactly which of your solutions reached the Pareto frontier, across which manifolds.
- **Batch Verification Page** — a dedicated `#/validator` route for dropping a folder of `.solution` files and verifying them all at once with a pass/fail/skip table.
- **Solution Playback** — embedded [om-web-simulator](https://omsim-web.pages.dev/player/) player with play/pause, cycle stepping, speed controls and solution downloads, while retaining the independent omclone **Preview** button. Falls back to the recorded GIF/video when solution files or WebGPU are unavailable.
- **API Proxy** — a Cloudflare Worker proxies requests to the leaderboard API (`zlbb.faendir.com`), avoiding CORS and keeping the API base configurable.

### Score compatibility

The current leaderboard schema uses `{ level, value }` for `areaINF`, `heightINF`, `widthINF`, and `boundingHexINF`. Growth rates are displayed with prime marks. Pareto axes keep the existing `value × 100000^level` numeric projection for all four `@∞` fields, with decimal ticks and sub-unit log domains. `looping` is independent of `rate`: steady-state solutions can have @∞ scores without being Looping.

Old saved scores retain finite measurements, but their new Looping status and previously unmeasured growth rates are unknown. Re-upload those `.solution` files to recalculate them; identical files from the old score version are not skipped as duplicates.

The bundled verifier is built from the [Akias86/omsim fork](https://github.com/Akias86/omsim), using the checkout with incremental simulation and collision controls (currently the `extension` branch). Those interfaces are already provided by the fork; no additional patch is needed in this project.

To update it, activate Emscripten and run `make libverify.wasm` inside your local fork checkout. This uses the current working tree, including uncommitted changes; no commit or push is required. The fork’s Makefile owns the compiler flags and exports, with PGO enabled by default (`PGO=0` disables it). Only after a successful build, manually copy `build/libverify.wasm` to this project’s `src/lib/verify/libverify.wasm`, then run `pnpm test`.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript 6, Vite 8, Recharts 3 |
| Backend / Hosting | Cloudflare Workers (Wrangler 4), SPA assets |
| Verification engine | WebAssembly (Emscripten-compiled `libverify.wasm`) |
| Parallelism | Web Worker pool (shared compiled WASM module, transferable buffers) |
| Lint | Oxlint (Oxc) |
| Package manager | pnpm |

## Architecture

```
Browser SPA ── /api/om/* ──▶ Cloudflare Worker ──▶ zlbb.faendir.com (leaderboard API)
   │
   ├─ /puzzles/*.puzzle  (static assets, used for verification)
   └─ libverify.wasm     (loaded into Web Workers, simulates & scores solutions)
```

- **Routing** — lightweight hash-based: `#/puzzle/:id` opens a puzzle; `#/validator` opens the batch verifier. Playing from either the records table or chart updates the URL to `#/puzzle/:id?record=:recordId`. Sharing or reloading it automatically opens the player and plays from the beginning, independent of the current view or filters. Closing clears the playback parameter; browser back/forward also synchronizes playback. Legacy records without IDs use a `solution` or `gif` parameter instead.
- **Verification pipeline** — `verifyBatch` orchestrates: prefetch all unique puzzle bytes (in-memory cached) → dispatch solution bytes to a Web Worker pool (2–4 workers, sharing one compiled WASM module) → collect results with progress callbacks. Workers receive solution buffers as transferables (zero-copy). Main-thread fallback if workers are unavailable.
- **Frontier computation** — `computeUserFrontierByManifold` merges leaderboard scores with user scores, computes the non-dominated set per manifold, and marks user solutions that reach the frontier **without being equal to any leaderboard record** (i.e. truly new frontier points, not ties).
- **Caching** — API responses are cached in `localStorage` (1-day TTL). User solutions and frontier summaries are also persisted, so the frontier list survives page reloads.

## Prerequisites

- Node.js (ES2023+ runtime)
- pnpm

## Getting Started

```bash
pnpm install
pnpm dev
```

Open the local dev server (Vite prints the URL). The dev server also runs the Cloudflare Worker locally via `@cloudflare/vite-plugin`, so `/api/om/*` proxying works out of the box.

## Player Configuration

The simulator origin defaults to `https://omsim-web.pages.dev`; the embedded player uses its `/player/` endpoint. Like `LEADERBOARD_API`, configure the **Worker runtime binding** `PLAYER_ORIGIN` in `wrangler.jsonc`:

```jsonc
"vars": {
  "LEADERBOARD_API": "https://zlbb.faendir.com",
  "PLAYER_ORIGIN": "https://omsim-web.pages.dev"
}
```

The playback area follows the native GIF's 826:647 aspect ratio (up to 826×647 CSS pixels), and the dialog fits the available viewport without padding around the image. The player draws into a fixed 826×647 canvas; browser zoom is left to the browser, without DPR compensation.

For local development, copy `.dev.vars.example` to `.dev.vars`; use `PLAYER_ORIGIN=http://127.0.0.1:4173` for a locally running `om-web-simulator`, then restart `pnpm dev`. In production, update the Worker binding through Wrangler configuration or secrets and refresh the page; **no frontend rebuild is required**. The frontend reads `/api/config` whenever a viewer opens, without caching it. This endpoint exposes only the public player origin, not other bindings or secrets. WebGPU requires HTTPS or localhost and a supported browser; remote solution downloads require CORS.

### Record author attribution

Only the playback dialog shows a small `by Author` line below its title; the name links to the attribution commit. It is hidden while loading, on lookup failure, or when no reliable attribution exists. Tables and chart tooltips are unchanged.

The browser asynchronously calls `/api/record-author?solution=…`. The Worker accepts only immutable zlbb solution links, extracts the commit SHA, and queries the fixed `zachtronics-leaderboards/om-leaderboard` repository. It accepts explicit `[BOT] … [Solution] by …` messages with a single corresponding solution file, not Git's author field. History-reset/import commits cannot recover the original authors.

`AUTHOR_CACHE` is a Workers KV binding declared in `wrangler.jsonc`. Local development uses local persistent KV; current Wrangler provisions/reuses the production namespace during deployment when its ID is omitted. You can also set an existing namespace's `id` explicitly. Full-SHA results and short-SHA aliases have **no expiration**, including confirmed unknowns. Versioned keys allow future parser changes. KV is eventually consistent, so simultaneous misses in different regions can still issue duplicate requests. Transient failures are never stored as permanent unknowns; the Worker briefly backs off and a later viewer open can retry.

GitHub works without authentication but has a lower rate limit. Optionally set a server-only token with `pnpm exec wrangler secret put GITHUB_TOKEN`; for local development add `GITHUB_TOKEN` to `.dev.vars`. Never use a `VITE_` variable or commit the token. Author lookup never blocks playback.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Vite dev server with HMR + local Worker |
| `pnpm build` | Type-check (`tsc -b`) then production build |
| `pnpm preview` | Build then preview the production build locally |
| `pnpm deploy` | Build then deploy to Cloudflare Workers (`wrangler deploy`) |
| `pnpm lint` | Run Oxlint |
| `pnpm test` | Run player/configuration, score, chart and WASM regression tests (Node.js test runner) |
| `pnpm cf-typegen` | Regenerate Cloudflare Worker type definitions |

## Deployment

Deployment targets Cloudflare Workers. The `LEADERBOARD_API` environment variable (default `https://zlbb.faendir.com`) configures the upstream leaderboard API and can be set in `wrangler.jsonc` or via Wrangler secrets.

```bash
pnpm deploy
```

## Project Structure

```
om-record-analyzer/
├── worker/index.ts          Cloudflare Worker: /api/om/* → leaderboard API proxy
├── public/puzzles/          264 .puzzle files (static assets for verification)
├── src/
│   ├── App.tsx              Hash-based router
│   ├── api/om.ts            API client + localStorage cache layer
│   ├── components/
│   │   ├── Sidebar.tsx      Puzzle tree, upload UI, frontier results list
│   │   └── ParetoChart.tsx  Main chart: scatter, Pareto overlay, zoom, user points
│   ├── state/userSolutions.tsx   Context: user uploads + frontier summary
│   ├── lib/
│   │   ├── manifold.ts      Manifold definitions + Pareto frontier algorithms
│   │   ├── userFrontier.ts  Shared frontier computation + batch summarization
│   │   └── verify/
│   │       ├── verifier.ts    WASM loader (compile once, instantiate per worker)
│   │       ├── verifyWorker.ts  Worker entry: runs verification in a worker
│   │       ├── workerPool.ts  Worker pool with main-thread fallback
│   │       ├── batch.ts      Batch orchestrator (prefetch + parallel dispatch)
│   │       ├── run.ts        Pure verification core (shared by worker & main)
│   │       ├── puzzle.ts     Cached puzzle byte fetch + parallel prefetch
│   │       ├── metrics.ts    Score metric computation from WASM
│   │       ├── solution-parse.ts  Parse .solution headers (puzzle ID, name)
│   │       ├── format.ts     Format VerifiedScore → readable string
│   │       ├── compare.ts    Diff verified score vs leaderboard record
│   │       └── libverify.wasm  Pre-compiled Emscripten verifier binary
│   └── test/TestPage.tsx    Batch verifier page (#/validator)
├── wrangler.jsonc           Cloudflare Worker config
└── vite.config.ts
```

## Notes

- Solution verification runs entirely client-side. The WASM binary (~180 KB) is compiled once on the main thread and the compiled `WebAssembly.Module` is shared with each worker, which only performs a cheap instantiation/link step.
- The frontier list after upload is recomputed against the **latest** leaderboard data (cache bypassed) to avoid stale records being misclassified as frontier after the leaderboard updates.
- `tests/` covers the embedded player client/protocol, Worker runtime configuration, scores, chart controls/axes and the bundled WASM verifier with Node.js's built-in test runner. `src/test/` holds the runtime batch-verifier page, not automated tests.

## Thanks

- [**omsim — Akias86 fork**](https://github.com/Akias86/omsim) — source of the bundled WebAssembly verifier, including incremental simulation and collision controls.
- [**omsim — original project**](https://github.com/ianh/omsim) — the original C simulation and scoring engine on which the fork is based.
- [**zachtronics-leaderboard-bot**](https://github.com/zachtronics-leaderboards/zachtronics-leaderboard-bot) — the Pareto frontier computation rules (manifold definitions, metric partial ordering, dominance detection) were derived from analyzing this project.

