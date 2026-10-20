export const AUTHOR_REPOSITORY = 'zachtronics-leaderboards/om-leaderboard'
export const AUTHOR_COMMIT_URL = `https://github.com/${AUTHOR_REPOSITORY}/commit/`

export interface RecordAuthor {
  name: string
  url: string
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
