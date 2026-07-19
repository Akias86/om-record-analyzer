import type { OmRecordDTO, OmMetricDTO } from '../types'

const BASE = '/api/om'
const CACHE_PREFIX = 'om-cache:'

interface CacheEntry {
  data: unknown
  timestamp: number
}

const DEFAULT_TTL = 86400 // seconds, 1 day (local cache for stable endpoints)

// Cache status reported by the Worker via the `x-om-cache` response header.
// `hit` = served from the Worker edge cache, `miss` = fetched upstream and
// stored, `bypass` = client asked for fresh data (chart view), fetched
// upstream and the cache was refreshed.
export type CacheStatus = 'hit' | 'miss' | 'bypass'

interface RequestOptions {
  useCache?: boolean
  ttl?: number // seconds, local (localStorage) TTL
  // Use the browser localStorage cache. Stable, low-volume endpoints
  // (metrics, puzzle list) keep this on for instant loads. The records
  // path turns it off so the Worker edge cache is the single source of
  // truth and the `x-om-cache` status header is meaningful.
  localCache?: boolean
}

// In-flight dedup: identical concurrent requests share a single Promise so
// we never issue two network calls for the same URL at the same time.
const inflight = new Map<string, Promise<FetchResult<unknown>>>()

export interface FetchResult<T> {
  data: T
  cache: CacheStatus
}

function readCache(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

function writeCache(key: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
  } catch { /* storage full, ignore */ }
}

async function getWithStatus<T>(url: string, options?: RequestOptions): Promise<FetchResult<T>> {
  const { useCache = true, ttl = DEFAULT_TTL, localCache = true } = options ?? {}

  const pending = inflight.get(url)
  if (pending) return pending as Promise<FetchResult<T>>

  // Local (localStorage) fast path for stable endpoints.
  if (localCache && useCache) {
    const entry = readCache(url)
    if (entry !== null && Date.now() - entry.timestamp < ttl * 1000) {
      return { data: entry.data as T, cache: 'hit' }
    }
  }

  // `useCache: false` tells the Worker to bypass its edge cache and fetch
  // the latest leaderboard from upstream (used by the chart view). We use a
  // custom header instead of `Cache-Control: no-cache` because the browser
  // (DevTools "Disable cache" or a hard refresh) injects that header into
  // every request, which would wrongly bypass the batch-upload path too.
  const headers: Record<string, string> = useCache ? {} : { 'X-OM-Bypass-Cache': '1' }
  const p = (async () => {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const data = await res.json() as T
    const status = res.headers.get('x-om-cache')
    const cache: CacheStatus = status === 'hit' || status === 'miss' || status === 'bypass' ? status : 'miss'
    if (localCache && useCache) {
      writeCache(url, { data, timestamp: Date.now() })
    }
    return { data, cache }
  })()

  inflight.set(url, p as Promise<FetchResult<unknown>>)
  p.finally(() => { inflight.delete(url) })
  return p as Promise<FetchResult<T>>
}

async function get<T>(url: string, options?: RequestOptions): Promise<T> {
  return (await getWithStatus<T>(url, options)).data
}

const RECORDS_URL = (puzzleId: string) => `${BASE}/puzzle/${puzzleId}/records?includeFrontier=true`

// Records bypass the localStorage cache; the Worker edge cache (30 min TTL)
// is the source of truth so the returned `x-om-cache` status is meaningful.
export function fetchRecords(puzzleId: string, options?: RequestOptions): Promise<OmRecordDTO[]> {
  return get<OmRecordDTO[]>(RECORDS_URL(puzzleId), { localCache: false, ...options })
}

// Same as fetchRecords but exposes the Worker cache status, used by the
// batch-upload frontier summary to report how many puzzles were served
// from the edge cache.
export function fetchRecordsWithStatus(puzzleId: string, options?: RequestOptions): Promise<FetchResult<OmRecordDTO[]>> {
  return getWithStatus<OmRecordDTO[]>(RECORDS_URL(puzzleId), { localCache: false, ...options })
}

export function fetchMetrics(options?: RequestOptions): Promise<OmMetricDTO[]> {
  return get<OmMetricDTO[]>(`${BASE}/metrics`, options)
}

export interface OmPuzzleListDTO {
  id: string
  displayName: string
  type: string
  group: {
    id: string
    displayName: string
    collection: {
      id: string
      displayName: string
    }
  }
  altIds?: string[]
}

export function fetchPuzzleList(options?: RequestOptions): Promise<OmPuzzleListDTO[]> {
  return get<OmPuzzleListDTO[]>(`${BASE}/puzzles`, options)
}

let puzzleMapPromise: Promise<Map<string, OmPuzzleListDTO>> | null = null

// Cached map of puzzleId → puzzle meta. Shared by getPuzzleMeta and by
// the verifier's prefetchPuzzles (which filters out ids not in the
// official list to avoid guaranteed-404 .puzzle requests).
export function getPuzzleMap(): Promise<Map<string, OmPuzzleListDTO>> {
  if (!puzzleMapPromise) {
    puzzleMapPromise = fetchPuzzleList().then((list) => {
      const map = new Map<string, OmPuzzleListDTO>()
      for (const p of list) map.set(p.id, p)
      return map
    })
    puzzleMapPromise.catch(() => {
      puzzleMapPromise = null
    })
  }
  return puzzleMapPromise
}

export function getPuzzleMeta(id: string): Promise<OmPuzzleListDTO | undefined> {
  return getPuzzleMap().then((map) => map.get(id))
}

export interface PuzzleTreeNode {
  id: string
  displayName: string
  type: string
}

export interface GroupTreeNode {
  id: string
  displayName: string
  collectionId: string
  puzzles: PuzzleTreeNode[]
}

export interface CollectionTreeNode {
  id: string
  displayName: string
  groups: GroupTreeNode[]
}

let treePromise: Promise<CollectionTreeNode[]> | null = null

export function getPuzzleTree(): Promise<CollectionTreeNode[]> {
  if (!treePromise) {
    treePromise = fetchPuzzleList().then((list) => {
      const collections = new Map<string, CollectionTreeNode>()
      const groups = new Map<string, GroupTreeNode>()
      for (const p of list) {
        const colId = p.group.collection.id
        let colNode = collections.get(colId)
        if (!colNode) {
          colNode = { id: colId, displayName: p.group.collection.displayName, groups: [] }
          collections.set(colId, colNode)
        }
        const grpKey = `${colId}/${p.group.id}`
        let grpNode = groups.get(grpKey)
        if (!grpNode) {
          grpNode = { id: p.group.id, displayName: p.group.displayName, collectionId: colId, puzzles: [] }
          groups.set(grpKey, grpNode)
          colNode.groups.push(grpNode)
        }
        grpNode.puzzles.push({ id: p.id, displayName: p.displayName, type: p.type })
      }
      return [...collections.values()]
    })
    treePromise.catch(() => { treePromise = null })
  }
  return treePromise
}

export interface OmPuzzleDetail {
  id: string
  displayName: string
  type: string
  group: {
    id: string
    displayName: string
    collection: {
      id: string
      displayName: string
    }
  }
}

export function fetchPuzzleDetail(puzzleId: string): Promise<OmPuzzleDetail> {
  return getPuzzleMeta(puzzleId).then((meta) => {
    if (!meta) throw new Error(`puzzle not found: ${puzzleId}`)
    const { id, displayName, type, group } = meta
    return { id, displayName, type, group }
  })
}
