import { AUTHOR_COMMIT_URL, solutionReference, type RecordAuthor } from '../lib/recordAuthor'

export async function fetchRecordAuthor(solution: string | null, signal: AbortSignal): Promise<RecordAuthor | null> {
  const ref = solutionReference(solution)
  if (!ref) return null
  const response = await fetch(`/api/record-author?${new URLSearchParams({ solution: solution! })}`, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`Author lookup failed: HTTP ${response.status}`)
  const { author } = await response.json() as { author: RecordAuthor | null }
  if (author === null) return null
  if (!author || typeof author.name !== 'string' || !author.name.trim() || author.name.length > 256
    || typeof author.url !== 'string' || !author.url.startsWith(AUTHOR_COMMIT_URL)) throw new Error('Invalid author attribution')
  const sha = author.url.slice(AUTHOR_COMMIT_URL.length)
  if (!/^[a-f0-9]{40}$/.test(sha) || !sha.startsWith(ref.sha)) throw new Error('Invalid author commit')
  return author
}
