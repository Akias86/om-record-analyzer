import type { LevelValue, OmScoreDTO } from '../../types'

/* ---------------------------------------------------------------------------
   Parser for the zlbb score-string notation used by the community leaderboard
   file names, e.g.

     20g-0i-3c-2a-1h-1.5w-2b-0.5r-2a-1h-1.5w-2b-OTL
     100g-108i-395c-74a-66r-74a-TL            (production puzzle)
     100g-15i-83c-183a-16h-12r-4a2-2h1-L      (polymer, area@∞ level 2)

   Letters are cost(g), instructions(i), cycles(c), area(a), height(h),
   width(w), bounding hex(b) and rate(r). The geometry letters repeat once:
   the first group is the victory score, the second the @∞ score, where a
   trailing digit is the growth level (`4a2` → 4a''). A final token of
   O/T/L carries the Overlap / Trackless / Looping flags.

   Dev-only: used by the offline demo dataset so the redesigned UI can be
   exercised without the leaderboard API.
--------------------------------------------------------------------------- */

const METRIC_TOKEN = /^(\d+(?:\.\d+)?)([gicahwbr])(\d*)$/
const FLAG_TOKEN = /^[OTL]+$/
const GEOMETRY = new Set(['a', 'h', 'w', 'b'])

export interface ScoreFlags {
  overlap: boolean
  trackless: boolean
  looping: boolean
}

export function parseScoreFlags(token: string | null | undefined): ScoreFlags {
  return {
    overlap: !!token?.includes('O'),
    trackless: !!token?.includes('T'),
    looping: !!token?.includes('L'),
  }
}

export function parseScoreString(input: string): OmScoreDTO | null {
  const tokens = input.split('-')
  const last = tokens[tokens.length - 1]
  const flags = parseScoreFlags(FLAG_TOKEN.test(last ?? '') ? last : null)
  if (FLAG_TOKEN.test(last ?? '')) tokens.pop()
  if (tokens.length === 0) return null

  const score: OmScoreDTO = {
    cost: Number.NaN,
    instructions: Number.NaN,
    cycles: Number.NaN,
    area: Number.NaN,
    height: null,
    width: null,
    boundingHex: null,
    rate: null,
    overlap: flags.overlap,
    trackless: flags.trackless,
    looping: flags.looping,
    areaINF: null,
    heightINF: null,
    widthINF: null,
    boundingHexINF: null,
  }

  const seen = new Set<string>()
  let infinity = false
  for (const token of tokens) {
    const match = METRIC_TOKEN.exec(token)
    if (!match) return null
    const value = Number(match[1])
    const letter = match[2] as string
    const level = match[3] ? Number(match[3]) : 0
    if (!Number.isFinite(value) || !Number.isInteger(level) || level < 0) return null
    // The second appearance of a geometry letter opens the @∞ group.
    if (!infinity && GEOMETRY.has(letter) && seen.has(letter)) infinity = true
    seen.add(letter)

    const levelValue = (): LevelValue => ({ level, value })
    if (!infinity) {
      switch (letter) {
        case 'g': score.cost = value; break
        case 'i': score.instructions = value; break
        case 'c': score.cycles = value; break
        case 'a': score.area = value; break
        case 'h': score.height = value; break
        case 'w': score.width = value; break
        case 'b': score.boundingHex = value; break
        case 'r': score.rate = value; break
        default: return null
      }
      continue
    }
    switch (letter) {
      case 'a': score.areaINF = levelValue(); break
      case 'h': score.heightINF = levelValue(); break
      case 'w': score.widthINF = levelValue(); break
      case 'b': score.boundingHexINF = levelValue(); break
      // Cost/instructions/cycles/rate are not restated at infinity; the
      // victory value already covers them.
      case 'g': case 'i': case 'c': case 'r': break
      default: return null
    }
  }

  for (const key of ['cost', 'instructions', 'cycles', 'area'] as const) {
    if (!Number.isFinite(score[key])) return null
  }
  return score
}
