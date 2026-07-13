import type { OmCollectionDTO, OmGroupDTO, OmPuzzleDTO } from '../types'

const BASE = '/api/om'
const CACHE_PREFIX = 'om-cache:'

interface CacheEntry {
  data: unknown
  timestamp: number
}

const DEFAULT_TTL = 86400 // seconds, 1 day

interface RequestOptions {
  useCache?: boolean
  ttl?: number // seconds
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

async function get<T>(url: string, options?: RequestOptions): Promise<T> {
  const { useCache = true, ttl = DEFAULT_TTL } = options ?? {}
  if (useCache) {
    const entry = readCache(url)
    if (entry !== null && Date.now() - entry.timestamp < ttl * 1000) {
      return entry.data as T
    }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json() as T
  if (useCache) writeCache(url, { data, timestamp: Date.now() })
  return data
}

export function fetchCollections(options?: RequestOptions): Promise<OmCollectionDTO[]> {
  return get<OmCollectionDTO[]>(`${BASE}/collections`, options)
}

export function fetchGroupsByCollection(collectionId: string, options?: RequestOptions): Promise<OmGroupDTO[]> {
  return get<OmGroupDTO[]>(`${BASE}/collection/${collectionId}/groups`, options)
}

export function fetchPuzzlesByGroup(groupId: string, options?: RequestOptions): Promise<OmPuzzleDTO[]> {
  return get<OmPuzzleDTO[]>(`${BASE}/group/${groupId}/puzzles`, options)
}
