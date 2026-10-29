/** Read the Worker binding when connecting the player, rather than baking it into the bundle. */
export async function fetchPlayerUrl(signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/config', { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`Player configuration failed: HTTP ${response.status}`)
  const config = await response.json() as { playerOrigin?: unknown }
  if (typeof config.playerOrigin !== 'string') throw new Error('Invalid player configuration')
  const origin = new URL(config.playerOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.playerOrigin) {
    throw new Error('Player origin must be an HTTP(S) origin without a path')
  }
  return `${origin.origin}/`
}
