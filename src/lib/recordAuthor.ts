export const AUTHOR_REPOSITORY = 'zachtronics-leaderboards/om-leaderboard'
export const AUTHOR_COMMIT_URL = `https://github.com/${AUTHOR_REPOSITORY}/commit/`

export interface RecordAuthor {
  name: string
  url: string
  committedAt: string | null
}

export function normalizeCommitTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  // Date silently rolls invalid calendar dates into the following month.
  const wallTime = value.slice(0, 19)
  const calendar = new Date(`${wallTime}Z`)
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== wallTime) return null
  return date.toISOString()
}

export function formatCommitTime(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// Only zlbb's immutable solution links identify an attribution commit. Never
// fetch a client-supplied host, branch, arbitrary GitHub repository or URL.
export function solutionReference(solution: string | null) {
  if (!solution || solution.length > 2048) return null
  try {
    const url = new URL(solution)
    if (url.origin !== 'https://zlbb.faendir.com' || url.username || url.password || url.search || url.hash) return null
    const match = /^\/l\/om\/([a-f0-9]{8,40})\/([A-Za-z0-9_-]{1,100})\/([^/]+)$/.exec(url.pathname)
    if (!match) return null
    const recordId = decodeURIComponent(match[3])
    if (!/^[A-Za-z0-9][A-Za-z0-9.'()+_-]{0,511}$/.test(recordId)) return null
    return { sha: match[1], recordId }
  } catch {
    return null
  }
}
