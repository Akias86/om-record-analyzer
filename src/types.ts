export interface OmCollectionDTO {
  id: string
  displayName: string
}

export interface OmGroupDTO {
  id: string
  displayName: string
  collectionId: string
}

export interface OmPuzzleDTO {
  id: string
  displayName: string
  groupId: string
  type: string
}

export interface OmScoreDTO {
  cost: number
  instructions: number
  overlap: boolean
  trackless: boolean
  cycles: number
  area: number
  height: number | null
  width: number | null
  boundingHex: number | null
  rate: number | null
  areaINFLevel: number | null
  areaINFValue: number | null
  heightINF: number | null
  widthINF: number | null
  boundingHexINF: number | null
}

export interface OmPuzzleDetailDTO {
  id: string
  displayName: string
  group: OmGroupDTO
  type: string
  altIds: string[]
}

export interface OmRecordDTO {
  id: string | null
  puzzle: OmPuzzleDetailDTO
  score: OmScoreDTO | null
  smartFormattedScore: string | null
  fullFormattedScore: string | null
  gif: string | null
  solution: string | null
  categoryIds: string[] | null
  smartFormattedCategories: string | null
  lastModified: string | null
  author: string | null
}

export interface OmMetricDTO {
  id: string
  displayName: string
  description: string
  type: string
}

export const NUMERIC_SCORE_KEYS = [
  'cost',
  'instructions',
  'cycles',
  'area',
  'height',
  'width',
  'boundingHex',
  'rate',
  'areaINF',
  'heightINF',
  'widthINF',
  'boundingHexINF',
  'sum',
  'sum4',
] as const

export type NumericScoreKey = (typeof NUMERIC_SCORE_KEYS)[number]

export const BOOL_SCORE_KEYS = ['overlap', 'trackless'] as const

export type BoolScoreKey = (typeof BOOL_SCORE_KEYS)[number]

export type BoolFilter = { [K in BoolScoreKey]: 'any' | 'true' | 'false' }

export const METRIC_LABELS: Record<string, string> = {
  cost: 'Cost',
  instructions: 'Instructions',
  cycles: 'Cycles',
  area: 'Area',
  height: 'Height',
  width: 'Width',
  boundingHex: 'Bounding Hex',
  rate: 'Rate',
  areaINF: 'Area@∞',
  heightINF: 'Height@∞',
  widthINF: 'Width@∞',
  boundingHexINF: 'Bounding Hex@∞',
  sum: 'Sum',
  sum4: 'Sum4',
  overlap: 'Overlap',
  trackless: 'Trackless',
}
