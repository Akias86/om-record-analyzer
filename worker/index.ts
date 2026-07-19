const CACHE_NAME = 'om-api-v1'
const RECORDS_TTL_MS = 30 * 60 * 1000 // 30 min for puzzle records
const STATIC_TTL_MS = 24 * 60 * 60 * 1000 // 1 day for metrics / puzzle list

// Bound the in-memory cache so a long-lived isolate doesn't grow without
// limit. 64 entries × ~100 KB ≈ 6 MB worst case, fine for a Worker.
const MEM_MAX_ENTRIES = 64

// Headers that must not leak into a stored cache entry: `no-store` would
// make `cache.put()` reject, cookies are per-user, and the rest are
// cache-directives aimed at the browser layer we explicitly bypass below.
const STRIP_FROM_STORED = [
  'cache-control', 'pragma', 'expires', 'set-cookie', 'vary',
  'x-om-cache', 'x-om-cached-at',
]

function ttlForPath(pathname: string): number {
  if (pathname.endsWith('/records')) return RECORDS_TTL_MS
  return STATIC_TTL_MS
}

function isCacheable(method: string, pathname: string): boolean {
  return method === 'GET' && pathname.startsWith('/api/om/')
}

// Headers for the response we hand back to the browser. Forces
// `Cache-Control: no-store` so the browser HTTP cache never short-circuits
// a fetch — the Worker cache is the single cache layer, which keeps the
// `x-om-cache` status header meaningful regardless of DevTools' own
// "Disable cache" toggle (that toggle only affects the browser HTTP cache).
function clientHeaders(src: Headers, status: 'hit' | 'miss' | 'bypass'): Headers {
  const h = new Headers(src)
  h.delete('x-om-cached-at')
  h.set('x-om-cache', status)
  h.set('cache-control', 'no-store')
  return h
}

// Headers for an entry we persist. Strips anything that would make
// `cache.put()` reject or cause stale per-user data, and stamps the fetch
// time so we can apply our own TTL.
function storedHeaders(src: Headers): Headers {
  const h = new Headers(src)
  for (const name of STRIP_FROM_STORED) h.delete(name)
  h.set('x-om-cached-at', String(Date.now()))
  return h
}

interface MemEntry {
  // ArrayBuffer (not a stream) so it can be served repeatedly without
  // one-shot stream semantics. Copied via `.slice(0)` on each hit.
  body: ArrayBuffer
  headers: Headers
  status: number
  cachedAt: number
}

// Module-level in-memory cache. Persists for the lifetime of the Worker
// isolate — the whole `pnpm dev` session locally, and a warm isolate in
// production. This is the primary cache and is 100% reliable in dev (the
// Cloudflare Cache API historically does not persist reliably under the
// vite plugin's local workerd).
const memCache = new Map<string, MemEntry>()

function memGet(key: string, ttlMs: number): MemEntry | null {
  const entry = memCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt >= ttlMs) {
    memCache.delete(key)
    return null
  }
  return entry
}

function memSet(key: string, entry: MemEntry): void {
  memCache.set(key, entry)
  // FIFO eviction: Map preserves insertion order, so the first key is the
  // oldest. Keep memory bounded for long-lived isolates.
  while (memCache.size > MEM_MAX_ENTRIES) {
    const oldest = memCache.keys().next().value
    if (oldest === undefined) break
    memCache.delete(oldest)
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/om/')) {
      return new Response(null, { status: 404 })
    }

    const apiUrl = new URL(url.pathname.slice(4) + url.search, env.LEADERBOARD_API)
    const cacheable = isCacheable(request.method, url.pathname)
    // Bypass signal is a custom header set only by the chart view
    // (`useCache: false`). We intentionally do NOT key off
    // `Cache-Control: no-cache` because the browser (DevTools' "Disable
    // cache" or a hard refresh) injects that header into every request,
    // which would incorrectly bypass the batch-upload path too.
    const bypass = request.headers.get('x-om-bypass-cache') === '1'
    const key = url.toString()
    const ttl = ttlForPath(url.pathname)

    if (cacheable && !bypass) {
      // 1. In-memory: instant, dev-reliable.
      const mem = memGet(key, ttl)
      if (mem) {
        return new Response(mem.body.slice(0), {
          status: mem.status,
          headers: clientHeaders(mem.headers, 'hit'),
        })
      }

      // 2. Cloudflare Cache API: cross-isolate / cross-user persistence in
      //    production. Best-effort in local dev (may not persist), but the
      //    in-memory layer above already covers the dev case.
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(key)
      if (cached) {
        const cachedAt = Number(cached.headers.get('x-om-cached-at') ?? 0)
        if (Date.now() - cachedAt < ttl) {
          // Backfill the in-memory cache so subsequent hits are instant
          // and don't re-query the Cache API.
          const buf = await cached.clone().arrayBuffer()
          memSet(key, { body: buf, headers: storedHeaders(cached.headers), status: cached.status, cachedAt })
          return new Response(cached.body, {
            status: cached.status,
            headers: clientHeaders(cached.headers, 'hit'),
          })
        }
      }
    }

    // Forward to upstream, dropping cache-directives meant for us plus the
    // custom bypass signal so they never reach the leaderboard API.
    const upstreamHeaders = new Headers(request.headers)
    upstreamHeaders.delete('cache-control')
    upstreamHeaders.delete('pragma')
    upstreamHeaders.delete('x-om-bypass-cache')
    const upstreamRes = await fetch(apiUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.body,
    })

    if (!cacheable || !upstreamRes.ok) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: clientHeaders(upstreamRes.headers, bypass ? 'bypass' : 'miss'),
      })
    }

    // Read the body once into an ArrayBuffer. We serve the original
    // upstream stream to the client and use buffer copies for the caches,
    // which avoids the one-shot stream semantics that make `cache.put`
    // unreliable in local workerd.
    const bodyBuf = await upstreamRes.clone().arrayBuffer()
    const sHeaders = storedHeaders(upstreamRes.headers)
    const now = Date.now()

    // Always refresh the caches on a successful upstream fetch, including
    // bypass requests from the chart view. Bypass means "don't READ the
    // cache, fetch fresh" — but the fresh result MUST be written back so
    // the next non-bypass request (e.g. a batch upload moments later)
    // benefits from it. Gating this on `!bypass` was a bug that left the
    // chart's fresh fetch invisible to subsequent uploads.
    memSet(key, { body: bodyBuf.slice(0), headers: sHeaders, status: upstreamRes.status, cachedAt: now })

    // Write-through to the Cache API for cross-isolate persistence in prod.
    // ArrayBuffer-backed Response avoids the stream issues that silently
    // fail `cache.put` in local dev.
    const cache = await caches.open(CACHE_NAME)
    const stored = new Response(bodyBuf.slice(0), { status: upstreamRes.status, headers: sHeaders })
    ctx.waitUntil(cache.put(key, stored))

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: clientHeaders(upstreamRes.headers, bypass ? 'bypass' : 'miss'),
    })
  },
} satisfies ExportedHandler<Env>
