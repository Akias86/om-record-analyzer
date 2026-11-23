import type { OmType } from './manifold'

/* Human labels for the leaderboard's puzzle types, plus the short form used in
   dense places (sidebar rows, badges). */

export const PUZZLE_TYPE_LABELS: Record<OmType, string> = {
  NORMAL: 'Standard',
  PRODUCTION: 'Production',
  POLYMER_HEIGHT: 'Polymer · height',
  POLYMER_WIDTH: 'Polymer · width',
  POLYMER_SKEW: 'Polymer · skew',
}

export const PUZZLE_TYPE_SHORT: Record<OmType, string> = {
  NORMAL: 'STD',
  PRODUCTION: 'PROD',
  POLYMER_HEIGHT: 'POLY H',
  POLYMER_WIDTH: 'POLY W',
  POLYMER_SKEW: 'POLY S',
}

export function puzzleTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null
  return PUZZLE_TYPE_LABELS[type as OmType] ?? null
}

export function puzzleTypeShort(type: string | null | undefined): string | null {
  if (!type) return null
  return PUZZLE_TYPE_SHORT[type as OmType] ?? null
}
