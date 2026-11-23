# Offline demo dataset

Development-only fixture that lets the UI run without the leaderboard API
(`zlbb.faendir.com`), which is handy for front-end work, review previews and
demos on a restricted network.

Enable it with `?demo=1` on any URL (the flag is remembered in `localStorage`,
so hash navigation keeps it); `?demo=0` turns it back off. In `pnpm dev` the
app also offers it from the error state when the leaderboard API is
unreachable.

| File | Contents |
| --- | --- |
| `puzzles.json` | All 264 puzzles: real ids, names, types and collection/group hierarchy |
| `scores.json` | Real leaderboard score strings, sampled to at most 32 per puzzle (8.2k records) |
| `scoreString.ts` | Parser for the zlbb `40g-11i-127c-7a-3h-2.5w-3b-22r-…-TL` notation |
| `records.ts` | Builds `OmRecordDTO[]`, recomputing category badges with the app's own frontier algorithm |
| `index.ts` | Answers `/api/om/puzzles`, `/api/om/metrics` and `/api/om/puzzle/:id/records` |

## Provenance

Puzzle names and hierarchy come from the game's own puzzle files
(`public/puzzles/*.puzzle`) and from
[`zachtronics-leaderboards/om-leaderboard`](https://github.com/zachtronics-leaderboards/om-leaderboard),
which is released into the public domain (Unlicense). Score strings are the
file names of that repository's solutions, sampled per puzzle to keep this
fixture small; `solution` links point back at the original files, so real-time
playback works when the browser can reach GitHub.

Nothing here ships to production: `src/api/demo.ts` loads the module behind
`import.meta.env.DEV`.

## Regenerating

The dataset is generated from the repository tree and the bundled `.puzzle`
files; see `pnpm test` coverage in `tests/demo-scores.test.mjs` for the parser
contract. Re-run the extraction against a fresh
`GET /repos/zachtronics-leaderboards/om-leaderboard/git/trees/master?recursive=1`
when the leaderboard adds puzzles.
