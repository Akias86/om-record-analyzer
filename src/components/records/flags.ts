import { BOOL_SCORE_KEYS } from '../../types'
import type { BoolScoreKey } from '../../types'

export type FlagState = 'asc' | 'desc' | null
export interface Flags { o: FlagState; t: FlagState; l: FlagState }

// Active flags always precede numeric metrics in O → T → L order.
export const FLAG_ORDER = BOOL_SCORE_KEYS
export const FLAG_STATE_KEYS = { overlap: 'o', trackless: 't', looping: 'l' } as const
const FLAG_CYCLES: Record<BoolScoreKey, FlagState[]> = {
  overlap: ['asc', 'desc', null],
  trackless: [null, 'desc', 'asc'],
  looping: [null, 'desc', 'asc'],
}

export function parseFlags(saved: string | null): Flags {
  const flags: Flags = { o: 'asc', t: null, l: null }
  try {
    const parsed = JSON.parse(saved ?? 'null') as Partial<Flags> | null
    for (const key of Object.values(FLAG_STATE_KEYS)) {
      const value = parsed?.[key]
      if (value === null || value === 'asc' || value === 'desc') flags[key] = value
    }
  } catch { /* invalid settings: keep defaults */ }
  return flags
}

export function nextFlagState(flag: BoolScoreKey, current: FlagState): FlagState {
  const cycle = FLAG_CYCLES[flag]
  return cycle[(cycle.indexOf(current) + 1) % cycle.length]
}

export function activeFlagSorting(flags: Flags): { id: BoolScoreKey; desc: false }[] {
  return FLAG_ORDER.filter((flag) => flags[FLAG_STATE_KEYS[flag]] !== null)
    .map((id) => ({ id, desc: false }))
}
