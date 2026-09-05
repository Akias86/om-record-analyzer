import { useEffect } from 'react'
import { sumScores, trackedGeometry } from '../lib/verify'
import type { VerifyPartial, VerifySolutionResult } from '../lib/verify'

interface SolutionDetailModalProps {
  result: VerifySolutionResult | null
  partial: VerifyPartial | null
  puzzleId: string | null
  puzzleName: string | null
  solutionName: string | null
  onClose: () => void
}

interface DetailCell {
  label: string
  value: string
  sub?: string
}

interface DetailSection {
  title: string
  live?: boolean
  cells: DetailCell[]
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-'
  if (n === Infinity) return '\u221E'
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 1000) / 1000)
}

function fmtBool(b: boolean | null | undefined): string {
  if (b === null || b === undefined) return '-'
  return b ? 'Yes' : 'No'
}

function geq(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-'
  return `\u2265 ${fmtNum(n)}`
}

function buildFinalSections(result: VerifySolutionResult, partial: VerifyPartial | null): DetailSection[] {
  const score = result.score
  const type = result.puzzleType
  const tracked = trackedGeometry(type ?? undefined)
  const production = type === 'PRODUCTION'

  const basicFromScore = score != null
  const basic: DetailCell[] = [
    {
      label: 'Cost',
      value: basicFromScore ? String(score.cost) : partial?.basic ? String(partial.basic.cost) : '-',
    },
    {
      label: 'Instructions',
      value: basicFromScore ? String(score.instructions) : partial?.basic ? String(partial.basic.instructions) : '-',
    },
    {
      label: 'Trackless',
      value: basicFromScore ? fmtBool(score.trackless) : partial?.basic ? fmtBool(partial.basic.trackless) : '-',
    },
    {
      label: 'Overlap',
      value: basicFromScore ? fmtBool(score.overlap) : partial?.basic ? fmtBool(partial.basic.overlap) : '-',
    },
  ]

  const victory: DetailCell[] = []
  if (score) {
    const sums = sumScores(score, type)
    victory.push(
      { label: 'Cycles', value: fmtNum(score.cycles) },
      { label: 'Area', value: fmtNum(score.area) },
    )
    if (tracked.height) victory.push({ label: 'Height', value: fmtNum(score.height) })
    if (tracked.width) victory.push({ label: 'Width', value: fmtNum(score.width) })
    if (tracked.boundingHex) victory.push({ label: 'Bounding Hex', value: fmtNum(score.boundingHex) })
    victory.push({ label: 'Sum', value: fmtNum(sums.sum) })
    if (!production) victory.push({ label: 'Sum4', value: fmtNum(sums.sum4) })
  } else {
    victory.push(
      { label: 'Cycles', value: '-' },
      { label: 'Area', value: '-' },
      { label: 'Sum', value: '-' },
    )
    if (!production) victory.push({ label: 'Sum4', value: '-' })
  }

  const infinity: DetailCell[] = []
  // @∞ estimation fallback — ONLY while the loop question is genuinely undecided:
  // the run was truncated at the cycle limit, not converged, and no collision
  // ever halted the sim.  Any collision (post-win or not) or a settled non-loop
  // outcome freezes the answer for good (advance sim stops there permanently),
  // so those cases keep the earlier rule: official @∞ missing means '-'.
  const loopUndecided =
    result.passed && result.analysis?.steadyState === false && result.analysis?.collisionCycle == null
  const inf = loopUndecided ? (partial?.infinity ?? null) : null
  // full-precision display: official rates are 7-decimal fixed-point (see
  // analyzeSolution / metrics.ts); never shorten them to 3 decimals.
  const fmtExact = (n: number): string => (n === Infinity ? '\u221E' : String(n))
  const est = (finalVal: number | null, liveVal: number | null | undefined): string => {
    if (finalVal !== null && finalVal !== undefined && !Number.isNaN(finalVal)) return fmtExact(finalVal)
    if (liveVal == null || Number.isNaN(liveVal)) return '-'
    return `\u2248 ${fmtExact(liveVal)}`
  }
  if (score) {
    const areaINF = score.areaINFLevel !== null && score.areaINFValue !== null
      ? `${fmtNum(score.areaINFValue)}a${"'".repeat(score.areaINFLevel)}`
      : inf?.area != null
        ? `\u2248 ${fmtNum(inf.area)}a`
        : '-'
    const rate = result.analysis?.rate ?? score.rate
    infinity.push(
      {
        label: 'Rate',
        value: est(rate, inf?.rate),
        sub: rate === null && inf?.rate != null ? 'last live estimate' : undefined,
      },
      { label: 'Area', value: areaINF },
    )
    if (tracked.height) infinity.push({ label: 'Height', value: est(score.heightINF, inf?.height) })
    if (tracked.width) infinity.push({ label: 'Width', value: est(score.widthINF, inf?.width) })
    if (tracked.boundingHex) infinity.push({ label: 'Bounding Hex', value: est(score.boundingHexINF, inf?.boundingHex) })
  } else {
    infinity.push(
      { label: 'Rate', value: est(null, inf?.rate), sub: inf?.rate != null ? 'last live estimate' : undefined },
      { label: 'Area', value: inf?.area != null ? `\u2248 ${fmtNum(inf.area)}a` : '-' },
    )
    if (tracked.height) infinity.push({ label: 'Height', value: est(null, inf?.height) })
    if (tracked.width) infinity.push({ label: 'Width', value: est(null, inf?.width) })
    if (tracked.boundingHex) infinity.push({ label: 'Bounding Hex', value: est(null, inf?.boundingHex) })
  }

  const analysis = result.analysis
  // without convergence the observed last-product cycle is only a lower bound:
  // more deliveries may be coming, so keep the '≥' the live view already used.
  const lastProduct = analysis
    ? analysis.infiniteOutputs
      ? { value: '\u221E', sub: undefined }
      : analysis.lastProductCycle != null
        ? {
            value: analysis.steadyState ? fmtNum(analysis.lastProductCycle) : geq(analysis.lastProductCycle),
            sub: analysis.collisionCycle != null && !result.passed
              ? 'stopped by collision'
              : analysis.steadyState
                ? undefined
                : 'not converged',
          }
        : { value: '-', sub: analysis.steadyState ? undefined : 'not converged' }
    : { value: '-', sub: undefined }
  const sim: DetailCell[] = [
    {
      label: 'Collision Cycle',
      value: analysis?.collisionCycle != null ? fmtNum(analysis.collisionCycle) : '-',
      sub: analysis?.collisionCycle == null
        ? undefined
        : result.passed
          ? 'after winning delivery — ignored'
          : analysis.collisionReason ?? undefined,
    },
    {
      label: 'Last Product Cycle',
      value: lastProduct.value,
      sub: lastProduct.sub,
    },
  ]

  return [
    { title: 'Basic', cells: basic },
    { title: '@V', cells: victory },
    { title: '@\u221E', cells: infinity },
    { title: 'Simulation', cells: sim },
  ]
}

function buildLiveSections(partial: VerifyPartial, type: string | null): DetailSection[] {
  const tracked = trackedGeometry(type ?? undefined)
  const production = type === 'PRODUCTION'
  const basic = partial.basic
  const victory = partial.victory
  const streaming = partial.phase === 'passed'

  const basicCells: DetailCell[] = basic
    ? [
        { label: 'Cost', value: String(basic.cost) },
        { label: 'Instructions', value: String(basic.instructions) },
        { label: 'Trackless', value: fmtBool(basic.trackless) },
        { label: 'Overlap', value: fmtBool(basic.overlap) },
      ]
    : ['Cost', 'Instructions', 'Trackless', 'Overlap'].map((label) => ({ label, value: '-' }))

  const victoryCells: DetailCell[] = []
  const vCycles = victory?.cycles ?? null
  const vArea = victory?.area ?? null
  victoryCells.push({ label: 'Cycles', value: fmtNum(vCycles) })
  victoryCells.push({ label: 'Area', value: fmtNum(vArea) })
  if (tracked.height) victoryCells.push({ label: 'Height', value: fmtNum(victory?.height ?? null) })
  if (tracked.width) victoryCells.push({ label: 'Width', value: fmtNum(victory?.width ?? null) })
  if (tracked.boundingHex) victoryCells.push({ label: 'Bounding Hex', value: fmtNum(victory?.boundingHex ?? null) })
  if (production) {
    victoryCells.push({
      label: 'Sum',
      value: basic && vCycles != null ? String(basic.cost + basic.instructions + vCycles) : '-',
    })
  } else if (basic && vCycles != null && vArea != null) {
    const sum = basic.cost + vCycles + vArea
    victoryCells.push({ label: 'Sum', value: String(sum) })
    victoryCells.push({ label: 'Sum4', value: String(sum + basic.instructions) })
  } else {
    victoryCells.push({ label: 'Sum', value: '-' })
    victoryCells.push({ label: 'Sum4', value: '-' })
  }

  // estimates are only honest while the loop question is still open: once a
  // collision was observed (sim frozen -> steady state out of reach for good)
  // or the board converges (official values arrive with the final result),
  // the @∞ metrics are missing, not estimated.
  const inf = partial.collisionCycle != null || partial.converged ? null : partial.infinity
  const approx = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? '-' : `\u2248 ${String(n)}`)
  const infinityCells: DetailCell[] = []
  infinityCells.push(
    { label: 'Rate', value: approx(inf?.rate) },
    // live Area estimate stays '-' on purpose: the final is a growth-order value
    // (e.g. 134a''), not the plain current-board area, so there is no honest
    // intermediate to stream before convergence classifies it.
    { label: 'Area', value: '-' },
  )
  if (tracked.height) infinityCells.push({ label: 'Height', value: approx(inf?.height) })
  if (tracked.width) infinityCells.push({ label: 'Width', value: approx(inf?.width) })
  if (tracked.boundingHex) infinityCells.push({ label: 'Bounding Hex', value: approx(inf?.boundingHex) })

  const simCells: DetailCell[] = [
    {
      label: 'Collision Cycle',
      value: partial.collisionCycle != null
        ? fmtNum(partial.collisionCycle)
        : partial.limitReached || partial.converged
          ? '-'
          : `> ${fmtNum(partial.cycle)}`,
      sub: partial.collisionIgnorable
        ? 'after winning delivery — ignored'
        : !streaming && partial.phase === 'failed'
          ? 'stopped by collision'
          : undefined,
    },
    {
      label: 'Last Product Cycle',
      value: streaming ? geq(partial.lastProductCycle) : fmtNum(partial.lastProductCycle),
      sub: streaming ? undefined : partial.phase === 'failed' ? 'stopped by collision' : undefined,
    },
  ]

  return [
    { title: 'Basic', cells: basicCells },
    { title: '@V', cells: victoryCells },
    { title: '@\u221E', cells: infinityCells, live: streaming },
    { title: 'Simulation', live: streaming, cells: simCells },
  ]
}

export function SolutionDetailModal({ result, partial, puzzleId, puzzleName, solutionName, onClose }: SolutionDetailModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const type = result?.puzzleType ?? null
  const sections = result
    ? buildFinalSections(result, partial)
    : partial
      ? buildLiveSections(partial, type)
      : []
  const errorText = result?.error ?? (partial?.phase === 'failed' ? partial.collisionReason ?? undefined : undefined)

  return (
    <div className="tp-detail-backdrop" onClick={onClose}>
      <div className="tp-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tp-detail-header">
          <div className="tp-detail-heading">
            <div className="tp-detail-title-row">
              <span className="tp-detail-title">{puzzleName ?? puzzleId ?? result?.puzzleId ?? '(unknown puzzle)'}</span>
              {(result?.puzzleId ?? puzzleId) && <span className="tp-detail-id">{result?.puzzleId ?? puzzleId}</span>}
              {result?.puzzleType && <span className="tp-detail-type">{result.puzzleType}</span>}
            </div>
            {solutionName && <div className="tp-detail-solution-name">{solutionName}</div>}
          </div>
          <button type="button" className="tp-detail-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>

        {errorText && <div className="tp-detail-error">{errorText}</div>}
        {!result && partial && partial.phase === 'verifying' && (
          <div className="tp-detail-note">Verifying\u2026</div>
        )}

        {sections.map((s) => (
          <section key={s.title} className="tp-detail-section">
            <h3 className="tp-detail-section-title">
              {s.title}
              {s.live && <span className="tp-detail-live">live</span>}
            </h3>
            <div className="tp-detail-grid">
              {s.cells.map((c) => (
                <div key={c.label} className={`tp-detail-cell ${c.value === '-' ? 'is-empty' : ''}`}>
                  <span className="tp-detail-cell-label">{c.label}</span>
                  <span className="tp-detail-cell-value">{c.value}</span>
                  {c.sub && <span className="tp-detail-cell-sub">{c.sub}</span>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
