import { useEffect } from 'react'
import { sumScores, trackedGeometry } from '../lib/verify'
import type { VerifySolutionResult } from '../lib/verify'

interface SolutionDetailModalProps {
  result: VerifySolutionResult
  puzzleName: string | null
  solutionName: string | null
  onClose: () => void
}

interface DetailCell {
  label: string
  value: string
  sub?: string
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

function buildSections(result: VerifySolutionResult): { title: string; cells: DetailCell[] }[] {
  const score = result.score
  const type = result.puzzleType
  const tracked = trackedGeometry(type ?? undefined)
  const production = type === 'PRODUCTION'

  const basic: DetailCell[] = [
    { label: 'Cost', value: score ? String(score.cost) : '-' },
    { label: 'Instructions', value: score ? String(score.instructions) : '-' },
    { label: 'Trackless', value: score ? fmtBool(score.trackless) : '-' },
    { label: 'Overlap', value: score ? fmtBool(score.overlap) : '-' },
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
  if (score) {
    const areaINF = score.areaINFLevel !== null && score.areaINFValue !== null
      ? `${fmtNum(score.areaINFValue)}a${"'".repeat(score.areaINFLevel)}`
      : '-'
    const rate = result.analysis?.rate ?? score.rate
    infinity.push({ label: 'Rate', value: rate !== null ? String(rate) : '-' })
    infinity.push({ label: 'Area', value: areaINF })
    if (tracked.height) infinity.push({ label: 'Height', value: fmtNum(score.heightINF) })
    if (tracked.width) infinity.push({ label: 'Width', value: fmtNum(score.widthINF) })
    if (tracked.boundingHex) infinity.push({ label: 'Bounding Hex', value: fmtNum(score.boundingHexINF) })
  } else {
    infinity.push(
      { label: 'Rate', value: '-' },
      { label: 'Area', value: '-' },
    )
  }

  const analysis = result.analysis
  const lastProduct = analysis
    ? analysis.infiniteOutputs
      ? { value: '\u221E', sub: undefined }
      : analysis.lastProductCycle != null
        ? { value: fmtNum(analysis.lastProductCycle), sub: analysis.collisionCycle != null ? 'stopped by collision' : undefined }
        : { value: '-', sub: analysis.steadyState ? undefined : 'not converged' }
    : { value: '-', sub: undefined }
  const sim: DetailCell[] = [
    {
      label: 'Collision Cycle',
      value: analysis?.collisionCycle != null ? fmtNum(analysis.collisionCycle) : '-',
      sub: analysis?.collisionReason ?? undefined,
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

export function SolutionDetailModal({ result, puzzleName, solutionName, onClose }: SolutionDetailModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const sections = buildSections(result)

  return (
    <div className="tp-detail-backdrop" onClick={onClose}>
      <div className="tp-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tp-detail-header">
          <div className="tp-detail-heading">
            <div className="tp-detail-title-row">
              <span className="tp-detail-title">{puzzleName ?? result.puzzleId ?? '(unknown puzzle)'}</span>
              {result.puzzleId && <span className="tp-detail-id">{result.puzzleId}</span>}
              {result.puzzleType && <span className="tp-detail-type">{result.puzzleType}</span>}
            </div>
            {solutionName && <div className="tp-detail-solution-name">{solutionName}</div>}
          </div>
          <button type="button" className="tp-detail-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>

        {result.error && <div className="tp-detail-error">{result.error}</div>}

        {sections.map((s) => (
          <section key={s.title} className="tp-detail-section">
            <h3 className="tp-detail-section-title">{s.title}</h3>
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
