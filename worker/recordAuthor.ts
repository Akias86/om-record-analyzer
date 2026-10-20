import { AUTHOR_COMMIT_URL, AUTHOR_REPOSITORY, solutionReference } from '../src/lib/recordAuthor.ts'

export interface AuthorBindings {
  AUTHOR_CACHE: KVNamespace
  GITHUB_TOKEN?: string
}

interface CommitSummary {
  sha: string
  name: string | null
  recordId: string | null
}

interface GitHubCommit {
  sha?: unknown
  commit?: { message?: unknown }
  files?: { filename?: unknown; status?: unknown }[]
}

// Bump the version when changing parsing rules to re-evaluate old unknowns.
const CACHE_PREFIX = `author:v1:${AUTHOR_REPOSITORY}:`
const FULL_SHA = /^[a-f0-9]{40}$/
const RETRY_MS = 30_000

function summarize(data: GitHubCommit, ref: string, paginated: boolean): CommitSummary {
  if (typeof data.sha !== 'string' || !FULL_SHA.test(data.sha) || !data.sha.startsWith(ref)
    || typeof data.commit?.message !== 'string') throw new Error('Invalid GitHub commit')
  const summary: CommitSummary = { sha: data.sha, name: null, recordId: null }
  const subject = data.commit.message.split(/\r?\n/, 1)[0]
  const name = /^\[BOT\] .+ \[Solution\] by (.+)$/.exec(subject)?.[1].trim()
  // In particular, never attribute imported history to its maintainer, or use
  // Git's author field (normally the leaderboard bot) as the solution author.
  if (!name || name.length > 256 || /\p{Cc}/u.test(name)) return summary
  if (!Array.isArray(data.files)) throw new Error('Missing GitHub files')
  // zlbb's [Solution] commits add/update exactly one solution. Ambiguous batch
  // commits and other message formats are deliberately left unattributed.
  if (paginated || data.files.length !== 1) return summary
  const file = data.files[0]
  if (typeof file.filename !== 'string' || !['added', 'modified', 'renamed'].includes(String(file.status))) return summary
  const parts = file.filename.split('/')
  const filename = parts.pop()!
  const puzzle = parts.pop()
  if (!puzzle || !filename.startsWith(`${puzzle}_`) || !filename.endsWith('.solution')) return summary
  const recordId = filename.slice(puzzle.length + 1, -'.solution'.length)
  if (!/^[A-Za-z0-9][A-Za-z0-9.'()+_-]{0,511}$/.test(recordId)) return summary
  return { sha: data.sha, name, recordId }
}

function validSummary(value: CommitSummary | null, sha: string): value is CommitSummary {
  return !!value && value.sha === sha && (
    (value.name === null && value.recordId === null)
    || (typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 256 && typeof value.recordId === 'string')
  )
}

export function createAuthorHandler(now: () => number = Date.now) {
  const memory = new Map<string, CommitSummary>()
  const pending = new Map<string, Promise<CommitSummary>>()
  let retryAt = 0

  const remember = (ref: string, value: CommitSummary) => {
    memory.set(ref, value)
    if (memory.size > 256) memory.delete(memory.keys().next().value!)
  }

  const load = async (ref: string, env: AuthorBindings): Promise<CommitSummary> => {
    const sha = FULL_SHA.test(ref) ? ref : await env.AUTHOR_CACHE.get(`${CACHE_PREFIX}ref:${ref}`)
    if (sha && FULL_SHA.test(sha) && sha.startsWith(ref)) {
      const cached = await env.AUTHOR_CACHE.get<CommitSummary>(`${CACHE_PREFIX}commit:${sha}`, 'json')
      if (validSummary(cached, sha)) return cached
    }
    if (now() < retryAt) throw new Error('GitHub cooldown')
    let result: CommitSummary
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'om-record-analyzer',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      if (env.GITHUB_TOKEN?.trim()) headers.Authorization = `Bearer ${env.GITHUB_TOKEN.trim()}`
      // One file is enough for the single-solution format. This also avoids
      // downloading thousands of patches for the history-reset commit.
      const response = await fetch(`https://api.github.com/repos/${AUTHOR_REPOSITORY}/commits/${ref}?per_page=1`, {
        headers, redirect: 'manual', signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`)
      result = summarize(await response.json() as GitHubCommit, ref, /rel="next"/.test(response.headers.get('link') ?? ''))
    } catch (error) {
      // Transient errors, including 404/rate limits, are NOT permanent unknowns.
      // Back off briefly for other uncached requests in this Worker isolate.
      retryAt = now() + RETRY_MS
      throw error
    }
    // No expiration: full-SHA commit contents are immutable. Short refs are
    // stored separately, and only after the canonical result has been written.
    await env.AUTHOR_CACHE.put(`${CACHE_PREFIX}commit:${result.sha}`, JSON.stringify(result))
    if (ref !== result.sha) await env.AUTHOR_CACHE.put(`${CACHE_PREFIX}ref:${ref}`, result.sha)
    return result
  }

  const lookup = (ref: string, env: AuthorBindings): Promise<CommitSummary> => {
    const cached = memory.get(ref)
    if (cached) return Promise.resolve(cached)
    const existing = pending.get(ref)
    if (existing) return existing
    if (pending.size >= 4) return Promise.reject(new Error('Too many author lookups'))
    const promise = load(ref, env).then((value) => {
      remember(ref, value)
      remember(value.sha, value)
      return value
    }).finally(() => { pending.delete(ref) })
    pending.set(ref, promise)
    return promise
  }

  return async (request: Request, env: AuthorBindings): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store' }
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } })
    const ref = solutionReference(new URL(request.url).searchParams.get('solution'))
    if (!ref) return Response.json({ author: null }, { status: 400, headers })
    try {
      const value = await lookup(ref.sha, env)
      const author = value.name && value.recordId === ref.recordId
        ? { name: value.name, url: `${AUTHOR_COMMIT_URL}${value.sha}` } : null
      return Response.json({ author }, { headers })
    } catch {
      // Attribution is optional: never leak upstream errors, bindings or tokens.
      return Response.json({ author: null }, { status: 503, headers: { ...headers, 'Retry-After': '30' } })
    }
  }
}
