# OM Record Analyzer

A web tool for analyzing **Opus Magnum** (a Zachtronics puzzle game) records. It fetches leaderboard data from the community API and renders interactive Pareto frontier charts, with local browser-based solution verification powered by WebAssembly.

[中文说明](./README.zh.md)

## Features

- **Pareto Frontier Visualization** — interactive 2D scatter plots comparing any two metrics (cost, cycles, area, instructions, height, width, bounding hex, rate, and their `@∞` variants) for a selected puzzle. Supports log/linear scales, drag-to-zoom, overlap/trackless filters, and multi-manifold frontier computation.
- **Local Solution Verification** — upload `.solution` files (exported Opus Magnum saves) and verify them entirely in the browser via a compiled WebAssembly engine. Scores are computed locally — no server-side simulation.
- **Frontier Detection** — your verified solutions are overlaid on the leaderboard chart and classified as "on frontier" (green) or "off frontier" (red). After upload, the sidebar lists exactly which of your solutions reached the Pareto frontier, across which manifolds.
- **Batch Verification Page** — a dedicated `#/solver` route for dropping a folder of `.solution` files and verifying them all at once with a pass/fail/skip table.
- **API Proxy** — a Cloudflare Worker proxies requests to the leaderboard API (`zlbb.faendir.com`), avoiding CORS and keeping the API base configurable.

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

- **Routing** — lightweight hash-based: `#/puzzle/:id` opens the Pareto chart for a puzzle; `#/solver` opens the batch verifier.
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

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Vite dev server with HMR + local Worker |
| `pnpm build` | Type-check (`tsc -b`) then production build |
| `pnpm preview` | Build then preview the production build locally |
| `pnpm deploy` | Build then deploy to Cloudflare Workers (`wrangler deploy`) |
| `pnpm lint` | Run Oxlint |
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
├── public/puzzles/          252 .puzzle files (static assets for verification)
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
│   │       ├── convert.ts    VerifiedScore → OmScoreDTO
│   │       ├── compare.ts    Diff verified score vs leaderboard record
│   │       └── libverify.wasm  Pre-compiled Emscripten verifier binary
│   └── test/TestPage.tsx    Batch verifier page (#/solver)
├── wrangler.jsonc           Cloudflare Worker config
└── vite.config.ts
```

## Notes

- Solution verification runs entirely client-side. The WASM binary (~150 KB) is compiled once on the main thread and the compiled `WebAssembly.Module` is shared with each worker, which only performs a cheap instantiation/link step.
- The frontier list after upload is recomputed against the **latest** leaderboard data (cache bypassed) to avoid stale records being misclassified as frontier after the leaderboard updates.
- No test framework is configured; `src/test/` holds the runtime batch-verifier page, not automated tests.

## Thanks

- [**omsim**](https://github.com/ianh/omsim) — the WebAssembly verifier (`libverify.wasm`) is compiled from this project's C/C++ source. All solution simulation and scoring runs on its engine.
- [**zachtronics-leaderboard-bot**](https://github.com/F43nd1r/zachtronics-leaderboard-bot) — the Pareto frontier computation rules (manifold definitions, metric partial ordering, dominance detection) were derived from analyzing this project.

