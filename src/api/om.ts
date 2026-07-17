import type { OmRecordDTO, OmMetricDTO } from '../types'

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

export function fetchRecords(puzzleId: string, options?: RequestOptions): Promise<OmRecordDTO[]> {
  return get<OmRecordDTO[]>(`${BASE}/puzzle/${puzzleId}/records?includeFrontier=true`, options)
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

function getPuzzleMap(): Promise<Map<string, OmPuzzleListDTO>> {
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
