import type { OmScoreDTO } from '../../types'
import type { VerifiedScore } from './types'

export interface ScoreDiffEntry {
  key: keyof VerifiedScore
  verified: number
  record: number
  delta: number
}

const NUMERIC_KEYS: ReadonlyArray<keyof VerifiedScore> = [
  'cost',
  'instructions',
  'cycles',
  'area',
  'height',
  'width',
  'boundingHex',
  'rate',
  'areaINFLevel',
  'areaINFValue',
  'heightINF',
  'widthINF',
  'boundingHexINF',
]

export function diffScores(verified: VerifiedScore, record: OmScoreDTO | null): ScoreDiffEntry[] {
  const out: ScoreDiffEntry[] = []
  if (!record) return out
  const rec = record as unknown as Record<string, unknown>
  for (const key of NUMERIC_KEYS) {
    const rv = rec[key]
    if (rv === null || rv === undefined) continue
    const recordValue = typeof rv === 'number' ? rv : Number(rv)
    if (!Number.isFinite(recordValue)) continue
    const raw = verified[key]
    if (raw === null || raw === undefined || typeof raw === 'boolean') continue
    if (!Number.isFinite(raw)) continue
    out.push({ key, verified: raw, record: recordValue, delta: raw - recordValue })
  }
  return out
}
