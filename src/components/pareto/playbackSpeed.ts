export const DEFAULT_PLAYBACK_SPEED = 5
export const MIN_PLAYBACK_SPEED = 0
export const MAX_PLAYBACK_SPEED = 30

export function clampPlaybackSpeed(value: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, value))
    : DEFAULT_PLAYBACK_SPEED
}

export function wheelPlaybackSpeed(value: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return value
  // One wheel event is one tenth, independent of device delta magnitude.
  return clampPlaybackSpeed(Number((value - Math.sign(deltaY) * 0.1).toFixed(10)))
}

export function parsePlaybackSpeed(text: string): number | null {
  if (!text.trim()) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}
