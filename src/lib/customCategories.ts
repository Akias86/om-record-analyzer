import type { OmScoreDTO } from '../types'
import { compareMetric, getManifoldByLabel, supportsScore } from './manifold'
import type { Manifold, MetricId, OmType } from './manifold'
import { getMetricValue } from './metrics'

// User-defined categories, described by a text DSL:
//
//   category  := NAME? manifold ':' metric (',' metric)*
//   manifold  := '@' geo ('V' | '∞')                 # the 10 manifold labels
//   metric    := boolexpr | numexpr                  # first metric = admission
//   boolexpr  := 'true' | 'O' | 'T' | 'L' | '!' boolexpr | boolexpr '&' boolexpr | '(' boolexpr ')'
//   numexpr   := term (('+' | '-') term)*
//   term      := factor (('*' | '/') factor)*
//   factor    := atom | number | '-' factor | '(' numexpr ')'
//   atom      := 'g'|'i'|'c'|'a'|'h'|'w'|'b'|'r' | 'a∞'|'h∞'|'w∞'|'b∞' | "a0"|"a'"|"a''"
//   number    := digits with an optional decimal point
//
// The semantics mirror the zlbb bot's OmCategory: candidates pass
// manifold.supportsScore (all manifold fields non-null, which makes @∞
// categories looping-only) plus the admission boolean; the declared chain is
// compared lexicographically, then the manifold fields not covered by the
// declaration are appended in manifold declaration order, and a full tie
// falls back to the bot's `dataOrder`. Only scores identical in every field
// share a category.

export interface CustomCategoryDef {
  id: string
  name: string
  expression: string
  enabled: boolean
}

// What the Category column renders for a holding row.
export interface CustomCategoryBadge {
  id: string
  name: string
  expression: string
}

type BoolAtom = 'overlap' | 'trackless' | 'looping'

type BoolExpr =
  | { kind: 'const'; value: boolean }
  | { kind: 'mod'; mod: BoolAtom }
  | { kind: 'not'; expr: BoolExpr }
  | { kind: 'and'; left: BoolExpr; right: BoolExpr }

type AtomView = 'a0' | 'a1' | 'a2'

interface NumAtom {
  metric: MetricId
  view: AtomView | null
  text: string
  family: 'v' | 'inf'
}

type NumBinOp = '+' | '-' | '*' | '/'

// Arithmetic expression over score fields: sums, differences, products,
// ratios, numeric coefficients, parentheses and unary minus. Evaluated to a
// single finite number per score; a missing operand or a non-finite result
// (e.g. division by zero) makes the metric null, which sorts worst.
type NumExpr =
  | { kind: 'atom'; atom: NumAtom }
  | { kind: 'const'; value: number }
  | { kind: 'neg'; expr: NumExpr }
  | { kind: 'bin'; op: NumBinOp; left: NumExpr; right: NumExpr }

type ChainMetric =
  | { kind: 'bool'; expr: BoolExpr }
  | { kind: 'num'; expr: NumExpr }

interface ParsedCategory {
  name: string
  manifold: Manifold
  admission: BoolExpr
  chain: ChainMetric[]
  // Manifold fields appended after the declared chain, matching the bot's
  // `metrics + (manifold.scoreParts - metrics)`: Kotlin's list subtraction
  // only removes the declared metric objects themselves, so a bare value or
  // modifier covers its field while a composite (sum, product, negated or
  // AND-ed boolean, constant) covers nothing and its atoms reappear here.
  tiebreakers: MetricId[]
}

type ParseCategoryResult =
  | { ok: true; category: ParsedCategory }
  | { ok: false; error: string }

const MOD_LETTER: Record<BoolAtom, string> = { overlap: 'O', trackless: 'T', looping: 'L' }

const METRIC_ATOM_TEXT: Record<MetricId, string> = {
  overlap: 'O',
  trackless: 'T',
  looping: 'L',
  cost: 'g',
  instructions: 'i',
  cycles: 'c',
  area: 'a',
  height: 'h',
  width: 'w',
  boundingHex: 'b',
  rate: 'r',
  areaINF: 'a∞',
  heightINF: 'h∞',
  widthINF: 'w∞',
  boundingHexINF: 'b∞',
}

const METRIC_NAME_LETTER: Record<MetricId, string> = {
  overlap: 'O',
  trackless: 'T',
  looping: 'L',
  cost: 'G',
  instructions: 'I',
  cycles: 'C',
  area: 'A',
  height: 'H',
  width: 'W',
  boundingHex: 'B',
  rate: 'R',
  areaINF: 'A',
  heightINF: 'H',
  widthINF: 'W',
  boundingHexINF: 'B',
}

const BASE_ATOMS: Record<string, { metric: MetricId; family: 'v' | 'inf' }> = {
  g: { metric: 'cost', family: 'v' },
  i: { metric: 'instructions', family: 'v' },
  c: { metric: 'cycles', family: 'v' },
  a: { metric: 'area', family: 'v' },
  h: { metric: 'height', family: 'v' },
  w: { metric: 'width', family: 'v' },
  b: { metric: 'boundingHex', family: 'v' },
  r: { metric: 'rate', family: 'inf' },
}

const INF_ATOMS: Record<string, MetricId> = {
  a: 'areaINF',
  h: 'heightINF',
  w: 'widthINF',
  b: 'boundingHexINF',
}

const VIEW_ATOMS: Record<string, AtomView> = { '0': 'a0', "'": 'a1', "''": 'a2' }

const MANIFOLD_HINT = '@aV @iV @hV @wV @bV @a∞ @i∞ @h∞ @w∞ @b∞'

// Official category names, used only to hint when a custom category reuses
// one (not an error). Mixes the bot's enum ids with the display names shown
// in the Category column, which differ for several groups (OGC vs OG, ...).
export const OFFICIAL_CATEGORY_NAMES: readonly string[] = [
  'GC', 'GC_P', 'GA', 'GI', 'GI_P', 'GX', 'GX_P',
  'CG', 'CG_P', 'CA', 'CI', 'CI_P', 'CX', 'CX_P',
  'AG', 'AC', 'AX', 'AI',
  'IG', 'IG_P', 'IC', 'IC_P', 'IA', 'IX_P',
  'SUM', 'SUM_P', 'SUM4', 'Sum', 'Sum4',
  'HG', 'HC', 'WG', 'WC', 'BG', 'BC',
  'OGC', 'OCX', 'OAC', 'OIC', 'OGC_P', 'OCX_P', 'OIC_P',
  'OSUM', 'OSUM_P', 'OSUM4', 'OSum', 'OSum4',
  'TIG', 'TIC', 'TIA', 'TIG_P', 'TIC_P', 'TG', 'TC', 'TG_P', 'TC_P', 'TI',
  'RG', 'RG_P', 'RA', 'RI', 'RI_P', 'HR', 'WR', 'BR',
  'ORG', 'ORX', 'ORG_P', 'ORX_P',
  'OG', 'OC', 'OA', 'OI', 'OR',
]

// ---------------------------------------------------------------------------
// Value access
// ---------------------------------------------------------------------------

function infToNumber(v: number | 'Infinity' | null | undefined): number | null {
  if (v === null || v === undefined || v === 'Infinity') return null
  return v
}

// Finite numeric value used for comparing a single atom and for arithmetic
// inside an expression metric. Non-finite values (Infinity) and missing
// values collapse to null, which sorts last (worst) everywhere.
function finiteAtomValue(score: OmScoreDTO, atom: NumAtom): number | null {
  switch (atom.metric) {
    case 'cost': return score.cost
    case 'instructions': return score.instructions
    case 'cycles': return score.cycles
    case 'area': return score.area
    case 'height': return score.height
    case 'width': return score.width
    case 'boundingHex': return score.boundingHex
    case 'rate': return score.rate
    case 'heightINF': return infToNumber(score.heightINF)
    case 'widthINF': return infToNumber(score.widthINF)
    case 'boundingHexINF': return infToNumber(score.boundingHexINF)
    case 'areaINF': {
      const value = score.areaINFValue
      const level = score.areaINFLevel
      if (value === null || level === null) return null
      if (atom.view === 'a0') return level === 0 ? value : null
      if (atom.view === 'a1') return level === 0 ? 0 : level === 1 ? value : null
      if (atom.view === 'a2') return level <= 1 ? 0 : value
      // Plain a∞ inside an expression uses the same graded scale the table
      // uses; direct comparison of the bare atom keeps the bot's
      // level-then-value order.
      return getMetricValue(score, 'areaINF')
    }
    default: return null
  }
}

function compareRaw(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : a > b ? 1 : 0
}

function evalBoolExpr(expr: BoolExpr, score: OmScoreDTO): boolean {
  switch (expr.kind) {
    case 'const': return expr.value
    case 'mod':
      if (expr.mod === 'overlap') return score.overlap
      if (expr.mod === 'trackless') return score.trackless
      return score.rate !== null
    case 'not': return !evalBoolExpr(expr.expr, score)
    case 'and': return evalBoolExpr(expr.left, score) && evalBoolExpr(expr.right, score)
  }
}

// A single modifier, possibly negated, keeps that modifier's own order (the
// bot's Not delegates to its modifier "to keep logical metric order"); any
// other boolean expression compares as a plain boolean (false first).
function singleModifier(expr: BoolExpr): BoolAtom | null {
  if (expr.kind === 'mod') return expr.mod
  if (expr.kind === 'not' && expr.expr.kind === 'mod') return expr.expr.mod
  return null
}

function compareBoolMetric(a: OmScoreDTO, b: OmScoreDTO, expr: BoolExpr): number {
  const mod = singleModifier(expr)
  if (mod !== null) return compareMetric(mod, a, b)
  return (evalBoolExpr(expr, a) ? 1 : 0) - (evalBoolExpr(expr, b) ? 1 : 0)
}

function compareNumMetric(a: OmScoreDTO, b: OmScoreDTO, m: ChainMetric & { kind: 'num' }): number {
  // A bare area∞ keeps the bot's level-then-value order; anything else is
  // plain arithmetic on the finite numeric value.
  const atom = m.expr.kind === 'atom' ? m.expr.atom : null
  if (atom !== null && atom.metric === 'areaINF' && atom.view === null) return compareMetric('areaINF', a, b)
  return compareRaw(evalNumExpr(a, m.expr), evalNumExpr(b, m.expr))
}

function evalNumExpr(score: OmScoreDTO, expr: NumExpr): number | null {
  switch (expr.kind) {
    case 'atom': return finiteAtomValue(score, expr.atom)
    case 'const': return expr.value
    case 'neg': {
      const v = evalNumExpr(score, expr.expr)
      return v === null ? null : -v
    }
    case 'bin': {
      const left = evalNumExpr(score, expr.left)
      if (left === null) return null
      const right = evalNumExpr(score, expr.right)
      if (right === null) return null
      const result = expr.op === '+' ? left + right
        : expr.op === '-' ? left - right
          : expr.op === '*' ? left * right
            : left / right
      // Division by zero and other non-finite results sort worst (null).
      return Number.isFinite(result) ? result : null
    }
  }
}

// The bot's `dataOrder` (OmSolutionRepository.kt): overlap first, then every
// value part in its fixed order. It decides categories when the entire
// manifold chain ties, and both the data loader and the submit path use it,
// so holders are deterministic.
const DATA_ORDER: readonly MetricId[] = [
  'overlap',
  'cost', 'instructions', 'cycles', 'area', 'height', 'width', 'boundingHex',
  'rate', 'areaINF', 'heightINF', 'widthINF', 'boundingHexINF',
]

function compareScores(parsed: ParsedCategory, a: OmScoreDTO, b: OmScoreDTO): number {
  // The admission is the first element of the bot's comparator too; it never
  // separates admitted candidates, but keeping it first is faithful.
  let r = compareBoolMetric(a, b, parsed.admission)
  if (r !== 0) return r
  for (const m of parsed.chain) {
    r = m.kind === 'bool' ? compareBoolMetric(a, b, m.expr) : compareNumMetric(a, b, m)
    if (r !== 0) return r
  }
  for (const id of parsed.tiebreakers) {
    r = compareMetric(id, a, b)
    if (r !== 0) return r
  }
  // Final bot tiebreak: `scoreComparator.then(dataOrder)`. A full tie on the
  // manifold chain leaves only out-of-manifold parts (h/w/b against @V, or
  // cycles/area against @∞) and dataOrder covers all of them, so the holder
  // is deterministic — the same choice the bot's loader and submit path make.
  for (const id of DATA_ORDER) {
    r = compareMetric(id, a, b)
    if (r !== 0) return r
  }
  // Everything identical (e.g. a user solution duplicating a leaderboard
  // record): both rows share the hold.
  return 0
}

// Indices (into `scores`) of the category's holders. `scores` is the union of
// leaderboard and user scores the table judges; ties share the hold.
export function evaluateCategoryHolders(parsed: ParsedCategory, type: OmType, scores: OmScoreDTO[]): Set<number> {
  const holders = new Set<number>()
  if (!parsed.manifold.supportedTypes.includes(type)) return holders
  let best: number[] = []
  for (let i = 0; i < scores.length; i++) {
    const score = scores[i]
    if (!supportsScore(parsed.manifold, score)) continue
    if (!evalBoolExpr(parsed.admission, score)) continue
    if (best.length === 0) {
      best = [i]
      continue
    }
    const r = compareScores(parsed, score, scores[best[0]])
    if (r < 0) best = [i]
    else if (r === 0) best.push(i)
  }
  for (const i of best) holders.add(i)
  return holders
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class ParseError extends Error {}

interface Cursor {
  s: string
  i: number
}

function fail(message: string): never {
  throw new ParseError(message)
}

function skipWs(c: Cursor): void {
  while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++
}

function peek(c: Cursor): string {
  return c.i < c.s.length ? c.s[c.i] : ''
}

function peekWord(c: Cursor): string {
  const m = /^[A-Za-z]+/.exec(c.s.slice(c.i))
  return m ? m[0] : ''
}

function parseManifold(c: Cursor): Manifold {
  if (peek(c) !== '@') fail(`Expected a manifold (${MANIFOLD_HINT})`)
  c.i++
  const geo = peek(c).toLowerCase()
  if (!'aihwb'.includes(geo) || geo === '') fail(`Expected a manifold geometry letter (a i h w b)`)
  c.i++
  const p = peek(c)
  c.i++
  const point = p === 'V' || p === 'v' ? 'V' : p === '∞' ? '∞' : p
  const manifold = getManifoldByLabel(`@${geo}${point}`)
  if (!manifold) fail(`Unknown manifold '@${geo}${point}' — expected one of ${MANIFOLD_HINT}`)
  return manifold
}

function parseBoolExpr(c: Cursor): BoolExpr {
  return parseBoolAnd(c)
}

function parseBoolAnd(c: Cursor): BoolExpr {
  let left = parseBoolUnary(c)
  for (;;) {
    skipWs(c)
    if (peek(c) !== '&') break
    c.i++
    if (peek(c) === '&') c.i++
    left = { kind: 'and', left, right: parseBoolUnary(c) }
  }
  return left
}

function parseBoolUnary(c: Cursor): BoolExpr {
  skipWs(c)
  const ch = peek(c)
  if (ch === '!') {
    c.i++
    return { kind: 'not', expr: parseBoolUnary(c) }
  }
  if (ch === '(') {
    c.i++
    const inner = parseBoolAnd(c)
    skipWs(c)
    if (peek(c) !== ')') fail(`Expected ')'`)
    c.i++
    return inner
  }
  const word = peekWord(c).toLowerCase()
  if (word === 'true') {
    c.i += 4
    return { kind: 'const', value: true }
  }
  if (word === 'o' || word === 't' || word === 'l') {
    c.i += 1
    return { kind: 'mod', mod: word === 'o' ? 'overlap' : word === 't' ? 'trackless' : 'looping' }
  }
  fail(`Expected a boolean (true, O, T, L, !expr, expr & expr)`)
}

function parseNumAtom(c: Cursor): NumAtom {
  skipWs(c)
  const letter = peek(c).toLowerCase()
  if (!/[a-z]/.test(letter)) fail(`Expected a metric atom (g i c a h w b r)`)
  c.i++
  let suffix = ''
  if (letter === 'a') {
    const next = peek(c)
    if (next === '∞') {
      c.i++
      suffix = '∞'
    } else if (next === '0') {
      c.i++
      suffix = '0'
    } else if (next === "'") {
      c.i++
      if (peek(c) === "'") {
        c.i++
        suffix = "''"
      } else {
        suffix = "'"
      }
    }
  } else if (letter === 'h' || letter === 'w' || letter === 'b') {
    if (peek(c) === '∞') {
      c.i++
      suffix = '∞'
    }
  }
  const base = BASE_ATOMS[letter]
  if (!base) fail(`Unknown metric '${letter}' — expected g, i, c, a, h, w, b or r`)
  if (suffix === '') return { metric: base.metric, view: null, text: letter, family: base.family }
  if (suffix === '∞') {
    const metric = INF_ATOMS[letter]
    if (!metric) fail(`Unknown metric '${letter}∞' — only a∞, h∞, w∞ and b∞ have @∞ forms`)
    return { metric, view: null, text: `${letter}∞`, family: 'inf' }
  }
  const view = VIEW_ATOMS[suffix]
  return { metric: 'areaINF', view, text: `a${suffix}`, family: 'inf' }
}

const NUM_PRIMARY_START = /[0-9.]/

function parseNumExpr(c: Cursor): NumExpr {
  return parseAddSub(c)
}

function parseAddSub(c: Cursor): NumExpr {
  let left = parseMulDiv(c)
  for (;;) {
    skipWs(c)
    const ch = peek(c)
    if (ch !== '+' && ch !== '-') break
    c.i++
    left = { kind: 'bin', op: ch, left, right: parseMulDiv(c) }
  }
  return left
}

function parseMulDiv(c: Cursor): NumExpr {
  let left = parseUnary(c)
  for (;;) {
    skipWs(c)
    const ch = peek(c)
    if (ch !== '*' && ch !== '/') break
    c.i++
    left = { kind: 'bin', op: ch, left, right: parseUnary(c) }
  }
  return left
}

function parseUnary(c: Cursor): NumExpr {
  skipWs(c)
  const ch = peek(c)
  if (ch === '-') {
    c.i++
    return { kind: 'neg', expr: parseUnary(c) }
  }
  if (ch === '+') {
    c.i++
    return parseUnary(c)
  }
  return parsePrimary(c)
}

function parsePrimary(c: Cursor): NumExpr {
  skipWs(c)
  const ch = peek(c)
  if (ch === '(') {
    c.i++
    const inner = parseNumExpr(c)
    skipWs(c)
    if (peek(c) !== ')') fail(`Expected ')'`)
    c.i++
    return inner
  }
  if (NUM_PRIMARY_START.test(ch)) return parseNumber(c)
  if (!/[A-Za-z]/.test(ch)) fail(`Expected a number, a metric atom or '('`)
  return { kind: 'atom', atom: parseNumAtom(c) }
}

function parseNumber(c: Cursor): NumExpr {
  const m = /^(\d+(\.\d+)?|\.\d+)/.exec(c.s.slice(c.i))
  if (!m) fail(`Expected a number`)
  c.i += m[0].length
  return { kind: 'const', value: Number(m[0]) }
}

// Metrics starting with '-' or a digit can only be numeric; booleans start
// with O/T/L, 'true' or '!'. A leading '(' is decided by the first meaningful
// token inside, so `(g+c)*a` parses as arithmetic while `(O&T)` stays boolean.
function peekBoolStart(c: Cursor): boolean {
  let i = c.i
  for (;;) {
    while (i < c.s.length && /\s/.test(c.s[i])) i++
    const ch = c.s[i]
    if (ch === '(') {
      i++
      continue
    }
    if (ch === '!') return true
    if (ch === undefined || NUM_PRIMARY_START.test(ch) || ch === '-') return false
    const m = /^[A-Za-z]+/.exec(c.s.slice(i))
    if (!m) return false
    const word = m[0].toLowerCase()
    return word === 'true' || word === 'o' || word === 't' || word === 'l'
  }
}

function parseChainMetric(c: Cursor): ChainMetric {
  skipWs(c)
  if (peek(c) === '') fail('Expected a metric')
  if (peekBoolStart(c)) return { kind: 'bool', expr: parseBoolExpr(c) }
  return { kind: 'num', expr: parseNumExpr(c) }
}

function collectBoolParts(expr: BoolExpr, parts: Set<MetricId>): void {
  switch (expr.kind) {
    case 'const': return
    case 'mod': parts.add(expr.mod); return
    case 'not': collectBoolParts(expr.expr, parts); return
    case 'and': collectBoolParts(expr.left, parts); collectBoolParts(expr.right, parts); return
  }
}

function collectNumAtoms(expr: NumExpr, atoms: NumAtom[]): void {
  switch (expr.kind) {
    case 'atom': atoms.push(expr.atom); return
    case 'const': return
    case 'neg': collectNumAtoms(expr.expr, atoms); return
    case 'bin': collectNumAtoms(expr.left, atoms); collectNumAtoms(expr.right, atoms); return
  }
}

// Rule checks that need the parsed shape: every referenced metric part must
// belong to the manifold, and one computed metric cannot mix @V and @∞ atoms.
// Returns the manifold fields to append as tiebreakers (see ParsedCategory).
function validateChain(manifold: Manifold, admission: BoolExpr, chain: ChainMetric[]): MetricId[] {
  const requirePart = (metric: MetricId, text: string) => {
    if (!manifold.scoreParts.includes(metric)) {
      const available = manifold.scoreParts.map((p) => METRIC_ATOM_TEXT[p]).join(' ')
      fail(`Metric '${text}' is not part of manifold ${manifold.label} (available: ${available})`)
    }
  }
  const checkBool = (expr: BoolExpr) => {
    const parts = new Set<MetricId>()
    collectBoolParts(expr, parts)
    for (const p of parts) requirePart(p, METRIC_ATOM_TEXT[p])
  }
  checkBool(admission)
  for (const m of chain) {
    if (m.kind === 'bool') {
      checkBool(m.expr)
      continue
    }
    const atoms: NumAtom[] = []
    collectNumAtoms(m.expr, atoms)
    const family = atoms.length > 0 ? atoms[0].family : null
    for (const atom of atoms) {
      if (family !== null && atom.family !== family) {
        fail(`Cannot mix @V and @∞ metrics ('${atoms[0].text}' with '${atom.text}')`)
      }
      requirePart(atom.metric, atom.text)
    }
  }
  // Only a bare value/modifier is a ScorePart in the bot's model; those are
  // the declared metrics that `manifold.scoreParts - metrics` removes.
  const covered = new Set<MetricId>()
  if (admission.kind === 'mod') covered.add(admission.mod)
  for (const m of chain) {
    if (m.kind === 'bool') {
      if (m.expr.kind === 'mod') covered.add(m.expr.mod)
    } else {
      const atom = m.expr.kind === 'atom' ? m.expr.atom : null
      if (atom !== null && atom.view === null) covered.add(atom.metric)
    }
  }
  return manifold.scoreParts.filter((p) => !covered.has(p))
}

function boolDisplayName(expr: BoolExpr): string {
  switch (expr.kind) {
    case 'const': return expr.value ? 'O' : ''
    case 'mod': return MOD_LETTER[expr.mod]
    case 'not':
      if (expr.expr.kind === 'mod' && expr.expr.mod === 'overlap') return ''
      return `!${boolDisplayName(expr.expr)}`
    case 'and': return boolDisplayName(expr.left) + boolDisplayName(expr.right)
  }
}

// Additive/multiplicative chains of bare atoms keep the bot's Sum/X naming;
// any other arithmetic (coefficients, subtraction, division, parentheses)
// derives P for polynomial.
function additiveAtomsOnly(expr: NumExpr): boolean {
  if (expr.kind === 'atom') return true
  return expr.kind === 'bin' && expr.op === '+' && additiveAtomsOnly(expr.left) && additiveAtomsOnly(expr.right)
}

function multiplicativeAtomsOnly(expr: NumExpr): boolean {
  if (expr.kind === 'atom') return true
  return expr.kind === 'bin' && expr.op === '*' && multiplicativeAtomsOnly(expr.left) && multiplicativeAtomsOnly(expr.right)
}

function chainMetricName(m: ChainMetric): string {
  if (m.kind === 'bool') return boolDisplayName(m.expr)
  const single = m.expr.kind === 'atom' ? m.expr.atom : null
  if (single !== null) return METRIC_NAME_LETTER[single.metric]
  if (additiveAtomsOnly(m.expr)) return 'Sum'
  if (multiplicativeAtomsOnly(m.expr)) return 'X'
  return 'P'
}

function parseCategory(expression: string): ParseCategoryResult {
  try {
    const src = expression.trim()
    if (src === '') return { ok: false, error: 'Expression is empty' }
    const c: Cursor = { s: src, i: 0 }
    let nameToken: string | null = null
    if (peek(c) !== '@') {
      const m = /^[A-Za-z][A-Za-z0-9_]{0,7}/.exec(src.slice(c.i))
      if (!m) return { ok: false, error: `Expected a manifold (${MANIFOLD_HINT})` }
      nameToken = m[0].toUpperCase()
      c.i += m[0].length
      skipWs(c)
    }
    const manifold = parseManifold(c)
    skipWs(c)
    if (peek(c) !== ':') fail(`Expected ':' after manifold ${manifold.label}`)
    c.i++
    const admission = parseBoolExpr(c)
    const chain: ChainMetric[] = []
    for (;;) {
      skipWs(c)
      if (c.i >= c.s.length) break
      const sep = peek(c)
      if (sep !== ',' && sep !== '>') fail(`Expected ',' or '>' between metrics, found '${sep}'`)
      c.i++
      chain.push(parseChainMetric(c))
    }
    if (chain.length === 0) fail('Add at least one metric after the admission boolean')
    const tiebreakers = validateChain(manifold, admission, chain)
    const derived = boolDisplayName(admission) + chain.slice(0, 2).map(chainMetricName).join('')
    const name = nameToken ?? derived
    if (name === '') fail('Cannot derive a category name — write one before the manifold')
    return { ok: true, category: { name, manifold, admission, chain, tiebreakers } }
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message }
    throw err
  }
}

const parseCache = new Map<string, ParseCategoryResult>()

export function parseCategoryCached(expression: string): ParseCategoryResult {
  let result = parseCache.get(expression)
  if (result === undefined) {
    result = parseCategory(expression)
    parseCache.set(expression, result)
  }
  return result
}

// Explicit name entered in the manager, uppercase-normalized; the DSL's
// `NAME?` token uses the same shape. Returns null when it does not match.
export function normalizeCategoryName(raw: string): string | null {
  const name = raw.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,7}$/.test(name) ? name : null
}

// ---------------------------------------------------------------------------
// Display helpers (management UI)
// ---------------------------------------------------------------------------

function formatBool(expr: BoolExpr): string {
  switch (expr.kind) {
    case 'const': return expr.value ? 'true' : 'false'
    case 'mod': return MOD_LETTER[expr.mod]
    case 'not': {
      const inner = formatBool(expr.expr)
      return expr.expr.kind === 'and' ? `!(${inner})` : `!${inner}`
    }
    case 'and': return `${formatBool(expr.left)}&${formatBool(expr.right)}`
  }
}

const BIN_PRECEDENCE: Record<NumBinOp, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

function needsParens(child: NumExpr, parentOp: NumBinOp, isRight: boolean): boolean {
  if (child.kind === 'neg') return true
  if (child.kind !== 'bin') return false
  const childPrec = BIN_PRECEDENCE[child.op]
  const parentPrec = BIN_PRECEDENCE[parentOp]
  if (childPrec < parentPrec) return true
  return childPrec === parentPrec && isRight && (parentOp === '-' || parentOp === '/')
}

function formatNumExpr(expr: NumExpr): string {
  switch (expr.kind) {
    case 'atom': return expr.atom.text
    case 'const': return String(expr.value)
    case 'neg': {
      const inner = formatNumExpr(expr.expr)
      return expr.expr.kind === 'bin' ? `-(${inner})` : `-${inner}`
    }
    case 'bin': {
      const left = formatNumExpr(expr.left)
      const right = formatNumExpr(expr.right)
      const l = needsParens(expr.left, expr.op, false) ? `(${left})` : left
      const r = needsParens(expr.right, expr.op, true) ? `(${right})` : right
      return `${l}${expr.op}${r}`
    }
  }
}

function formatChainMetric(m: ChainMetric): string {
  if (m.kind === 'bool') return formatBool(m.expr)
  return formatNumExpr(m.expr)
}

interface CategoryChainDisplay {
  entries: string[]
  tiebreakers: string[]
}

export function formatCategoryChain(parsed: ParsedCategory): CategoryChainDisplay {
  return {
    entries: [formatBool(parsed.admission), ...parsed.chain.map(formatChainMetric)],
    tiebreakers: parsed.tiebreakers.map((m) => METRIC_ATOM_TEXT[m]),
  }
}