# Embedded solution player

`client.js`, `client.d.ts` and `protocol.js` are copied from `om-web-simulator` (`embed/client.*` and `src/embed/protocol.js`), using protocol version 1. The protocol import path is adjusted and the server-only command allowlist is omitted from the host copy. Keep these files and `tests/player-client.test.mjs` in sync when updating the player protocol; no sibling checkout is needed to build this project.

`GifViewer` fetches puzzle/solution bytes on the host and transfers copies to the cross-origin `/player/` iframe. The client checks origin, source window, protocol version, session and request IDs, and disposes outstanding requests when the viewer closes or changes records.

Configure the simulator origin with the Worker binding `PLAYER_ORIGIN` in `wrangler.jsonc` (default `https://omsim-web.pages.dev`), just like `LEADERBOARD_API`. Use `.dev.vars` for local overrides. Each viewer fetches `/api/config` with `no-store`, so updates to Worker bindings require no frontend rebuild. Only the public player origin is exposed. Individual `GifViewer` instances may override the complete player URL with the optional `playerUrl` prop.
