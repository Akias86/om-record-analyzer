import type { OmRecordDTO } from '../types'
import type { UserSolutionRecord } from '../state/userSolutions'

export interface PlaybackTarget {
  kind: 'record' | 'solution' | 'gif' | 'user'
  value: string
}

export interface Route {
  validator: boolean
  puzzleId: string | null
  playback: PlaybackTarget | null
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const queryStart = raw.indexOf('?')
  const path = queryStart < 0 ? raw : raw.slice(0, queryStart)
  const params = new URLSearchParams(queryStart < 0 ? '' : raw.slice(queryStart + 1))
  const empty: Route = { validator: false, puzzleId: null, playback: null }
  if (path === '/validator') return { ...empty, validator: true }
  const match = path.match(/^\/puzzle\/(.+)$/)
  if (!match) return empty
  let puzzleId: string
  try { puzzleId = decodeURIComponent(match[1]) } catch { return empty }
  for (const kind of ['record', 'solution', 'gif', 'user'] as const) {
    const value = params.get(kind)
    if (value) return { validator: false, puzzleId, playback: { kind, value } }
  }
  return { ...empty, puzzleId }
}

export function puzzleHash(puzzleId: string, playback: PlaybackTarget | null = null): string {
  const path = `#/puzzle/${encodeURIComponent(puzzleId)}`
  return playback ? `${path}?${new URLSearchParams({ [playback.kind]: playback.value })}` : path
}

// Prefer the stable API id; older records may only have a solution or media URL.
// Never use row/point indices, which change with sorting and leaderboard updates.
export function recordPlaybackTarget(record: OmRecordDTO): PlaybackTarget | null {
  if (record.id) return { kind: 'record', value: record.id }
  if (record.solution) return { kind: 'solution', value: record.solution }
  if (record.gif) return { kind: 'gif', value: record.gif }
  return null
}

export function findPlaybackRecord(records: OmRecordDTO[], puzzleId: string, target: PlaybackTarget): OmRecordDTO | undefined {
  if (target.kind === 'user') return undefined
  const field = target.kind === 'record' ? 'id' : target.kind
  // Resolve only against this puzzle's API data, not arbitrary URLs from the hash.
  return records.find((record) => record.puzzle.id === puzzleId && record[field] === target.value)
}

export function findUserPlaybackRecord(records: UserSolutionRecord[], puzzleId: string, target: PlaybackTarget): UserSolutionRecord | undefined {
  if (target.kind !== 'user') return undefined
  return records.find((record) => record.puzzleId === puzzleId && record.id === target.value)
}
