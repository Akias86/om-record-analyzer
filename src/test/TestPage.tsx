import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { verifySolutionFile } from '../lib/verify'
import type { VerifiedScore, VerifySolutionResult } from '../lib/verify/types'

type Status = 'idle' | 'loading' | 'done'

interface MetricRow {
  key: keyof VerifiedScore
  label: string
}

const METRIC_ROWS: ReadonlyArray<MetricRow> = [
  { key: 'cost', label: 'Cost (g)' },
  { key: 'instructions', label: 'Instructions (i)' },
  { key: 'cycles', label: 'Cycles (c)' },
  { key: 'area', label: 'Area (a)' },
  { key: 'height', label: 'Height (h)' },
  { key: 'width', label: 'Width (w)' },
  { key: 'boundingHex', label: 'Bounding Hex (b)' },
  { key: 'rate', label: 'Rate (r)' },
  { key: 'overlap', label: 'Overlap' },
  { key: 'trackless', label: 'Trackless' },
  { key: 'areaINFLevel', label: 'Area@∞ Level' },
  { key: 'areaINFValue', label: 'Area@∞ Value' },
  { key: 'heightINF', label: 'Height@∞' },
  { key: 'widthINF', label: 'Width@∞' },
  { key: 'boundingHexINF', label: 'Bounding Hex@∞' },
]

function formatValue(value: VerifiedScore[keyof VerifiedScore]): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value > 0 ? '∞' : '—'
    return Number.isInteger(value) ? String(value) : String(value)
  }
  return String(value)
}

export default function TestPage() {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<VerifySolutionResult | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setStatus('loading')
    setPageError(null)
    setResult(null)
    try {
      const r = await verifySolutionFile(file)
      setResult(r)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err))
    } finally {
      setStatus('done')
    }
  }, [])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }, [handleFile])

  const score = result?.score ?? null

  return (
    <div className="tp">
      <h1 className="tp-title">Opus Magnum 解法验证</h1>
      <p className="tp-sub">上传 .solution 文件，本地求解并显示关卡、是否过关与全部指标 · <a href="#/">返回</a></p>

      <div
        className={`tp-drop ${dragOver ? 'is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".solution"
          className="tp-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        {status === 'loading' ? '验证中…' : '点击或拖入 .solution 文件'}
      </div>

      {pageError && <div className="tp-error">{pageError}</div>}

      {status === 'done' && result && (
        <div className="tp-result">
          <div className="tp-head">
            <span className="tp-id">{result.puzzleId ?? '未知关卡'}</span>
            {result.puzzleType && <span className="tp-type">{result.puzzleType}</span>}
            <span className={`tp-pass ${result.passed ? 'is-pass' : 'is-fail'}`}>
              {result.passed ? '过关 ✓' : '未过关 ✗'}
            </span>
          </div>

          {!result.passed && result.error && <div className="tp-reason">{result.error}</div>}

          {result.passed && score && (
            <table className="tp-table">
              <tbody>
                {METRIC_ROWS.map((row) => (
                  <tr key={row.key}>
                    <th>{row.label}</th>
                    <td>{formatValue(score[row.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
