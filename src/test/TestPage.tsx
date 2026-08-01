import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { parseSolutionMeta, parsePuzzleMeta, formatScoreParts, verifyBatch, verifyInPool } from '../lib/verify'
import type { BatchInput, ScoreParts } from '../lib/verify'
import { getPuzzleMap } from '../api/om'
import './test.css'

type RowStatus = 'pending' | 'verifying' | 'done' | 'error' | 'skipped'

interface Row {
  solutionName: string | null
  puzzleId: string | null
  puzzleName: string | null
  parts: ScoreParts | null
  status: RowStatus
}

interface CustomRow {
  puzzleId: string | null
  puzzleName: string | null
  solutionName: string | null
  parts: ScoreParts | null
  status: RowStatus
  error: string | null
}

interface LoadedPuzzle {
  id: string
  name: string | null
  bytes: Uint8Array
}

type EffStatus = 'pending' | 'verifying' | 'pass' | 'fail' | 'error' | 'skipped'

function effStatus(r: { status: RowStatus; parts: ScoreParts | null }): EffStatus {
  if (r.status === 'done') return r.parts !== null ? 'pass' : 'fail'
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

  const [puzzles, setPuzzles] = useState<LoadedPuzzle[]>([])
  const [customRows, setCustomRows] = useState<CustomRow[]>([])
  const [customProgress, setCustomProgress] = useState<{ done: number; total: number } | null>(null)
  const [customRunning, setCustomRunning] = useState(false)
  const [isPuzzleOver, setIsPuzzleOver] = useState(false)
  const [isSolOver, setIsSolOver] = useState(false)
  const puzzleInputRef = useRef<HTMLInputElement>(null)
  const solInputRef = useRef<HTMLInputElement>(null)

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
        return { bytes, meta: parseSolutionMeta(bytes) }
      }),
    )
    parsed.sort((a, b) => comparePuzzleId(a.meta.puzzleId, b.meta.puzzleId))

    const puzzleMap = await getPuzzleMap().catch(() => new Map<string, { displayName: string }>())

    const inputs: BatchInput[] = []
    const initial: Row[] = []
    for (const { bytes, meta } of parsed) {
      inputs.push({ bytes, puzzleId: meta.puzzleId })
      initial.push({
        solutionName: meta.solutionName,
        puzzleId: meta.puzzleId,
        puzzleName: meta.puzzleId ? puzzleMap.get(meta.puzzleId)?.displayName ?? null : null,
        parts: null,
        status: meta.puzzleId ? 'pending' : 'skipped',
      })
    }
    setRows(initial)

    const pendingIndices = initial.map((r, i) => (r.status === 'pending' ? i : -1)).filter((i) => i >= 0)
    setRows((prev) => prev.map((r, i) => (pendingIndices.includes(i) ? { ...r, status: 'verifying' } : r)))

    await verifyBatch(
      inputs,
      (index, result) => {
        const parts = result.passed && result.score
          ? formatScoreParts(result.score, result.puzzleType ?? undefined)
          : null
        const status: RowStatus = result.puzzleId === null ? 'skipped' : 'done'
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, parts, status } : r)))
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

  const handlePuzzleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.name.endsWith('.puzzle'))
    if (files.length === 0) return
    const loaded = await Promise.all(
      files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const id = file.name.replace(/\.puzzle$/i, '')
        return { id, name: parsePuzzleMeta(bytes).name, bytes }
      }),
    )
    setPuzzles((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]))
      for (const p of loaded) map.set(p.id, p)
      return [...map.values()].sort((a, b) => comparePuzzleId(a.id, b.id))
    })
  }, [])

  const handleSolutionFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.name.endsWith('.solution'))
    if (files.length === 0) return

    const puzzleMap = new Map(puzzles.map((p) => [p.id, p]))
    if (puzzleMap.size === 0) return

    setCustomRunning(true)
    setCustomProgress({ done: 0, total: files.length })

    const parsed = await Promise.all(
      files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer())
        return { bytes, meta: parseSolutionMeta(bytes) }
      }),
    )
    parsed.sort((a, b) => comparePuzzleId(a.meta.puzzleId, b.meta.puzzleId))

    setCustomRows(
      parsed.map(({ meta }) => {
        const puzzle = meta.puzzleId ? puzzleMap.get(meta.puzzleId) : undefined
        return {
          puzzleId: meta.puzzleId,
          puzzleName: puzzle?.name ?? null,
          solutionName: meta.solutionName,
          parts: null,
          status: puzzle ? 'verifying' : 'skipped',
          error: puzzle
            ? null
            : meta.puzzleId
              ? `No uploaded puzzle for ID ${meta.puzzleId}`
              : 'Could not identify puzzle from solution file',
        }
      }),
    )

    const total = parsed.length
    let done = 0
    const finish = (): void => {
      done++
      setCustomProgress({ done, total })
    }
    await Promise.all(
      parsed.map(async ({ bytes, meta }, i) => {
        const puzzle = meta.puzzleId ? puzzleMap.get(meta.puzzleId) : undefined
        if (!puzzle) {
          finish()
          return
        }
        const result = await verifyInPool({
          puzzleId: meta.puzzleId as string,
          puzzleType: '',
          solutionBytes: bytes,
          puzzleBytes: puzzle.bytes,
        })
        const parts = result.passed && result.score ? formatScoreParts(result.score, undefined) : null
        setCustomRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, parts, status: 'done', error: result.passed ? null : result.error }
              : r,
          ),
        )
        finish()
      }),
    )

    setCustomRunning(false)
  }, [puzzles])

  const onPuzzleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsPuzzleOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handlePuzzleFiles(e.dataTransfer.files)
    }
  }, [handlePuzzleFiles])

  const onSolDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsSolOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleSolutionFiles(e.dataTransfer.files)
    }
  }, [handleSolutionFiles])

  const total = progress?.total ?? 0
  const doneCount = progress?.done ?? 0
  const passedCount = rows.filter((r) => r.parts !== null).length
  const failedCount = rows.filter((r) => r.status === 'error' || (r.status === 'done' && r.parts === null)).length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const cTotal = customProgress?.total ?? 0
  const cDoneCount = customProgress?.done ?? 0
  const cPassedCount = customRows.filter((r) => r.parts !== null).length
  const cFailedCount = customRows.filter((r) => r.status === 'error' || (r.status === 'done' && r.parts === null)).length
  const cPct = cTotal > 0 ? Math.round((cDoneCount / cTotal) * 100) : 0
  const solDisabled = puzzles.length === 0 || customRunning

  const visibleRows = rows.filter((r) => r.status !== 'skipped')
  const visibleCustomRows = customRows.filter((r) => r.status !== 'skipped')

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

      {visibleRows.length > 0 && (
        <table className="tp-batch">
          <thead>
            <tr>
              <th>Puzzle ID</th>
              <th>Puzzle Name</th>
              <th>Save Name</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => {
              const eff = effStatus(r)
              return (
                <tr key={i} className={`tp-row tp-row--${r.status}`}>
                  <td className="tp-cell-id">{r.puzzleId ?? ''}</td>
                  <td className="tp-cell-name">{r.puzzleName ?? ''}</td>
                  <td className="tp-cell-name">{r.solutionName ?? ''}</td>
                  <td className={`tp-cell-score ${r.parts === null ? 'is-empty' : ''}`}>
                    {r.status === 'verifying' ? (
                      <span className="tp-spin" aria-label="verifying" />
                    ) : r.parts ? (
                      <>
                        <div>{r.parts.victory}</div>
                        {r.parts.infinity !== null && <div>{r.parts.infinity}</div>}
                      </>
                    ) : (
                      ''
                    )}
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

      <section className="tp-section">
        <div className="tp-section-head">
          <h2 className="tp-section-title">Custom Puzzle Verification</h2>
          <p className="tp-sub">
            Upload .puzzle files, then their .solution files. Solutions are matched by the puzzle ID
            embedded in each file — the .puzzle filename is its ID (e.g. <code>P007.puzzle</code>).
          </p>
        </div>

        <div
          className={`tp-drop tp-drop--small ${isPuzzleOver ? 'is-over' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => setIsPuzzleOver(true)}
          onDragLeave={() => setIsPuzzleOver(false)}
          onDrop={onPuzzleDrop}
          onClick={() => puzzleInputRef.current?.click()}
        >
          <input
            ref={puzzleInputRef}
            type="file"
            accept=".puzzle"
            className="tp-file"
            multiple
            onChange={(e) => { if (e.target.files) void handlePuzzleFiles(e.target.files); e.target.value = '' }}
          />
          <svg className="tp-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M12 4L7 9M12 4L17 9" />
            <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
          </svg>
          <div className="tp-drop-main">Click to select .puzzle files</div>
          <div className="tp-drop-sub">or drag them here</div>
        </div>

        {puzzles.length > 0 && (
          <ul className="tp-puzzles">
            {puzzles.map((p) => (
              <li key={p.id} className="tp-puzzle">
                <span className="tp-puzzle-id">{p.id}</span>
                <span className="tp-puzzle-name">{p.name ?? '(unknown name)'}</span>
              </li>
            ))}
          </ul>
        )}

        <div
          className={`tp-drop tp-drop--small tp-drop--spaced ${solDisabled ? 'is-disabled' : ''} ${isSolOver ? 'is-over' : ''}`}
          onDragOver={(e) => { if (!solDisabled) e.preventDefault() }}
          onDragEnter={() => { if (!solDisabled) setIsSolOver(true) }}
          onDragLeave={() => setIsSolOver(false)}
          onDrop={onSolDrop}
          onClick={() => { if (!solDisabled) solInputRef.current?.click() }}
        >
          <input
            ref={solInputRef}
            type="file"
            accept=".solution"
            className="tp-file"
            multiple
            onChange={(e) => { if (e.target.files) void handleSolutionFiles(e.target.files); e.target.value = '' }}
          />
          {customRunning ? (
            <>
              <div className="tp-drop-main">Verifying… {cDoneCount}/{cTotal}</div>
              <div className="tp-progress-bar">
                <div className="tp-progress-fill" style={{ width: `${cPct}%` }} />
              </div>
            </>
          ) : (
            <>
              <svg className="tp-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4M12 4L7 9M12 4L17 9" />
                <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
              </svg>
              <div className="tp-drop-main">
                {puzzles.length === 0 ? 'Load .puzzle files first' : 'Click to select .solution files'}
              </div>
              <div className="tp-drop-sub">or drag them here</div>
            </>
          )}
        </div>

        {customProgress && (
          <div className="tp-stats">
            <div className="tp-stat">
              <span className="tp-stat-num">{cTotal}</span>
              <span className="tp-stat-label">Total</span>
            </div>
            <div className="tp-stat tp-stat--ok">
              <span className="tp-stat-num">{cPassedCount}</span>
              <span className="tp-stat-label">Passed</span>
            </div>
            <div className="tp-stat tp-stat--fail">
              <span className="tp-stat-num">{cFailedCount}</span>
              <span className="tp-stat-label">Failed</span>
            </div>
          </div>
        )}

        {visibleCustomRows.length > 0 && (
          <table className="tp-batch">
            <thead>
              <tr>
                <th>Puzzle ID</th>
                <th>Puzzle Name</th>
                <th>Save Name</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleCustomRows.map((r, i) => {
                const eff = effStatus(r)
                return (
                  <tr key={i} className={`tp-row tp-row--${r.status}`}>
                    <td className="tp-cell-id">{r.puzzleId ?? ''}</td>
                    <td className="tp-cell-name">{r.puzzleName ?? ''}</td>
                    <td className="tp-cell-name">{r.solutionName ?? ''}</td>
                    <td className={`tp-cell-score ${r.parts === null ? 'is-empty' : ''}`}>
                      {r.status === 'verifying' ? (
                        <span className="tp-spin" aria-label="verifying" />
                      ) : r.parts ? (
                        <>
                          <div>{r.parts.victory}</div>
                          {r.parts.infinity !== null && <div>{r.parts.infinity}</div>}
                        </>
                      ) : (
                        (r.error ?? '')
                      )}
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
      </section>
    </div>
  )
}
