import { readUserSolutionFile } from '../userSolutionFiles'

export async function loadSolutionBytes(url: string | null, localKey: string | undefined, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted()
  if (localKey) {
    const bytes = await readUserSolutionFile(localKey)
    signal.throwIfAborted()
    if (!bytes?.byteLength) throw new Error('This local solution file is unavailable. Re-upload the .solution file and reopen the player.')
    return bytes
  }
  if (!url) throw new Error('No solution file is available')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  return bytes
}
