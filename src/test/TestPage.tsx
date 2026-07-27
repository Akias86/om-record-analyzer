import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { parseSolutionMeta, formatFullScore, verifyBatch } from '../lib/verify'
import type { BatchInput } from '../lib/verify'
import './test.css'

type RowStatus = 'pending' | 'verifying' | 'done' | 'error' | 'skipped'

interface Row {
  fileName: string
  solutionName: string | null
  puzzleId: string | null
  fullScore: string | null
  status: RowStatus
}

type EffStatus = 'pending' | 'verifying' | 'pass' | 'fail' | 'error' | 'skipped'

function effStatus(r: Row): EffStatus {
  if (r.status === 'done') return r.fullScore !== null ? 'pass' : 'fail'
  return r.status
}

const STATUS_LABEL: Record<EffStatus, string> = {
  pending: 'Pending',
  verifying: 'Verifying',
  pass: 'Passed',
  fail: 'Failed',
  error: 'Error',
  skipped: 'Skipped',
}

function puzzleIdRank(id: string | null): number {
  if (!id) return 9
  const c = id[0]
  if (c === 'P') return 0
  if (c === 'w') return 1
  if (c === 'c') return 2
  return 3
}

function comparePuzzleId(a: string | null, b: string | null): number {
  const ra = puzzleIdRank(a)
  const rb = puzzleIdRank(b)
  if (ra !== rb) return ra - rb
  if (!a || !b) return 0
  return a.localeCompare(b, undefined, { numeric: true })
}

export default function TestPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [])

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const all = Array.from(fileList).filter((f) => {
      if (!f.name.endsWith('.solution')) return false
      const rel = f.webkitRelativePath
      if (rel && rel.split('/').length - 1 > 1) return false
      return true
    })
    if (all.length === 0) return

    setRunning(true)
    setProgress({ done: 0, total: all.length })

    const parsed = await Promise.all(
      all.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const meta = parseSolutionMeta(bytes)
        return { file, bytes, meta }
      }),
    )
    parsed.sort((a, b) => comparePuzzleId(a.meta.puzzleId, b.meta.puzzleId))

    const inputs: BatchInput[] = []
    const initial: Row[] = []
    for (const { file, bytes, meta } of parsed) {
      inputs.push({ bytes, puzzleId: meta.puzzleId })
      initial.push({
        fileName: file.name,
        solutionName: meta.solutionName,
        puzzleId: meta.puzzleId,
        fullScore: null,
        status: meta.puzzleId ? 'pending' : 'skipped',
      })
    }
    setRows(initial)

    const pendingIndices = initial.map((r, i) => (r.status === 'pending' ? i : -1)).filter((i) => i >= 0)
    setRows((prev) => prev.map((r, i) => (pendingIndices.includes(i) ? { ...r, status: 'verifying' } : r)))

    await verifyBatch(
      inputs,
      (index, result) => {
        const fullScore = result.passed && result.score
          ? formatFullScore(result.score, result.puzzleType ?? undefined)
          : null
        const status: RowStatus = result.puzzleId === null ? 'skipped' : 'done'
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, fullScore, status } : r)))
      },
      (done, total) => setProgress({ done, total }),
    )

    setRunning(false)
  }, [])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const total = progress?.total ?? 0
  const doneCount = progress?.done ?? 0
  const passedCount = rows.filter((r) => r.fullScore !== null).length
  const failedCount = rows.filter((r) => r.status === 'error' || (r.status === 'done' && r.fullScore === null)).length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  return (
    <div className="tp">
      <header className="tp-header">
        <div>
          <h1 className="tp-title">Opus Magnum Batch Verification</h1>
          <p className="tp-sub">Drop a folder of .solution files to verify all at once</p>
        </div>
        <a className="tp-back" href="#/">← Back</a>
      </header>

      <div
        className={`tp-drop ${running ? 'is-disabled' : ''} ${isOver ? 'is-over' : ''}`}
        onDragOver={(e) => { if (!running) e.preventDefault() }}
        onDragEnter={() => { if (!running) setIsOver(true) }}
        onDragLeave={() => setIsOver(false)}
        onDrop={onDrop}
        onClick={() => { if (!running) inputRef.current?.click() }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".solution"
          className="tp-file"
          multiple
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
        />
        {running ? (
          <>
            <div className="tp-drop-main">Verifying… {doneCount}/{total}</div>
            <div className="tp-progress-bar">
              <div className="tp-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <>
            <svg className="tp-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4M12 4L7 9M12 4L17 9" />
              <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
            </svg>
            <div className="tp-drop-main">Click to select a folder</div>
            <div className="tp-drop-sub">or drag .solution files here</div>
          </>
        )}
      </div>

      {progress && (
        <div className="tp-stats">
          <div className="tp-stat">
            <span className="tp-stat-num">{total}</span>
            <span className="tp-stat-label">Total</span>
          </div>
          <div className="tp-stat tp-stat--ok">
            <span className="tp-stat-num">{passedCount}</span>
            <span className="tp-stat-label">Passed</span>
          </div>
          <div className="tp-stat tp-stat--fail">
            <span className="tp-stat-num">{failedCount}</span>
            <span className="tp-stat-label">Failed</span>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <table className="tp-batch">
          <thead>
            <tr>
              <th>Puzzle ID</th>
              <th>Save Name</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const eff = effStatus(r)
              return (
                <tr key={i} className={`tp-row tp-row--${r.status}`}>
                  <td className="tp-cell-id">{r.puzzleId ?? ''}</td>
                  <td className="tp-cell-name">{r.solutionName ?? ''}</td>
                  <td className={`tp-cell-score ${r.fullScore === null ? 'is-empty' : ''}`}>
                    {r.status === 'verifying' ? <span className="tp-spin" aria-label="verifying" /> : (r.fullScore ?? '')}
                  </td>
                  <td className="tp-cell-status">
                    <span className={`tp-badge tp-badge--${eff}`}>{STATUS_LABEL[eff]}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
