export interface VerifiedScore {
  cost: number
  instructions: number
  overlap: boolean
  trackless: boolean
  cycles: number
  area: number
  width: number | null
  height: number | null
  boundingHex: number | null
  rate: number | null
  areaINFLevel: number | null
  areaINFValue: number | null
  heightINF: number | null
  widthINF: number | null
  boundingHexINF: number | null
}

export interface VerifySolutionResult {
  puzzleId: string | null
  puzzleType: string | null
  passed: boolean
  score: VerifiedScore | null
  error: string | null
}