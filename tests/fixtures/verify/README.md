# Verifier fixtures

- `looping.solution` and `non-looping.solution`: Stabilized Water (P007) records from the community leaderboard. Their pinned source URLs and expected API scores are in the matching JSON files (retrieved 2026-10-20).
- `post-win-collision.solution`: Durable Stitching (P296), 470G/29C. Its source URL and expected score are in the matching JSON file. It completes at cycle 29 and collides at cycle 39; streaming and non-streaming verification must both preserve the score and report `looping: false`.
- `growing.puzzle` and `growing.solution`: `test/puzzle/easy/infinite-throughput.puzzle` and `test/solution/easy/infinite-throughput-infinite-throughput-1.solution` from [ianh/omsim](https://github.com/ianh/omsim/tree/a88d12d8d100784aa525ee90259255b869bcba38/test). This repeating-output fixture checks per-output Looping plus finite height and linearly growing width/bounding hex.

P007 and P296 use their existing files in `public/puzzles/`. Tests require no network access.
