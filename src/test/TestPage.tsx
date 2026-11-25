import { useCallback, useEffect, useRef, useState, memo } from 'react'
import type { DragEvent } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowLeft, FileArchive, FolderUp, Puzzle, ShieldCheck } from 'lucide-react'
import { parseSolutionMeta, parsePuzzleMeta, customPuzzleType, formatScoreParts, verifyBatch, verifyInPool } from '../lib/verify'
import type { BatchInput, ScoreParts, VerifyPartial, VerifySolutionResult } from '../lib/verify'
import { getPuzzleMap } from '../api/om'
import { ThemeModeSwitch } from '../components/ThemeModeSwitch'
import { SolutionDetailModal } from './SolutionDetailModal'
import './test.css'

type RowStatus = 'pending' | 'verifying' | 'done' | 'error' | 'skipped'

interface Row {
  solutionName: string | null
  puzzleId: string | null
  puzzleName: string | null
  parts: ScoreParts | null
  status: RowStatus
  result: VerifySolutionResult | null
  partial: VerifyPartial | null
}

interface CustomRow {
  puzzleId: string | null
  puzzleName: string | null
  solutionName: string | null
  parts: ScoreParts | null
  status: RowStatus
  error: string | null
  result: VerifySolutionResult | null
  partial: VerifyPartial | null
}

interface DetailState {
  rowIndex: number | null
  result: VerifySolutionResult | null
  partial: VerifyPartial | null
  puzzleId: string | null
  puzzleName: string | null
  solutionName: string | null
}

interface LoadedPuzzle {
  id: string
  name: string | null
  puzzleType: string
  bytes: Uint8Array
}

type EffStatus = 'pending' | 'verifying' | 'pass' | 'fail' | 'error' | 'skipped'

function effStatus(r: { status: RowStatus; parts: ScoreParts | null; partial: VerifyPartial | null }): EffStatus {
  if (r.status === 'done') return r.parts !== null ? 'pass' : 'fail'
  if (r.status === 'verifying' && r.partial) {
    if (r.partial.phase === 'passed') return 'pass'
    if (r.partial.phase === 'failed') return 'fail'
  }
  return r.status
}

function badgeVariantForStatus(eff: EffStatus): 'success' | 'error' | 'info' | 'neutral' {
  if (eff === 'pass') return 'success'
  if (eff === 'fail' || eff === 'error') return 'error'
  if (eff === 'verifying') return 'info'
  return 'neutral'
}

function isRowClickable(r: { result: VerifySolutionResult | null; partial: VerifyPartial | null; status: RowStatus }): boolean {
  if (r.result) return true
  if (r.status === 'verifying' && r.partial && r.partial.phase !== 'verifying') return true
  return false
}

// Memoized so a progress tick for one row re-renders only that row: batch
// verification streams partials for many rows at once. Unchanged rows keep
// their object identity through the prev.map updates.
const ResultTableRow = memo(function ResultTableRow({ row, index, source, onOpen }: {
  row: Row & { error?: string | null }
  index: number
  source: 'batch' | 'custom'
  onOpen: (source: 'batch' | 'custom', index: number, row: Row & { error?: string | null }) => void
}) {
  const eff = effStatus(row)
  const clickable = isRowClickable(row)
  return (
    <tr
      className={`tp-row tp-row--${row.status} ${clickable ? 'is-clickable' : ''}`}
      title={clickable ? 'View details' : undefined}
      onClick={() => { if (clickable) onOpen(source, index, row) }}
    >
      <td className="tp-cell-id">{row.puzzleId ?? ''}</td>
      <td className="tp-cell-name">{row.puzzleName ?? ''}</td>
      <td className="tp-cell-name">{row.solutionName ?? ''}</td>
      <td className={`tp-cell-score ${row.parts === null ? 'is-empty' : ''}`}>
        {row.status === 'verifying' ? (
          <Spinner size="sm" label="Verifying" />
        ) : row.parts ? (
          <>
            <div>{row.parts.victory}</div>
            {row.parts.infinity !== null && <div>{row.parts.infinity}</div>}
          </>
        ) : (
          (row.error ?? '')
        )}
      </td>
      <td className="tp-cell-status">
        <Badge variant={badgeVariantForStatus(eff)} label={STATUS_LABEL[eff]} />
      </td>
    </tr>
  )
})

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
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [detailSource, setDetailSource] = useState<'batch' | 'custom' | null>(null)
  const detailSourceRef = useRef(detailSource)
  detailSourceRef.current = detailSource
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

    const puzzleMap = await getPuzzleMap().catch(() => null)
    const parsed = await Promise.all(
      all.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer())
        return { bytes, meta: parseSolutionMeta(bytes, puzzleMap) }
      }),
    )
    parsed.sort((a, b) => comparePuzzleId(a.meta.puzzleId, b.meta.puzzleId))

    const inputs: BatchInput[] = []
    const initial: Row[] = []
    for (const { bytes, meta } of parsed) {
      inputs.push({ bytes, puzzleId: meta.puzzleId })
      initial.push({
        solutionName: meta.solutionName,
        puzzleId: meta.puzzleId,
        puzzleName: meta.puzzleId ? puzzleMap?.get(meta.puzzleId)?.displayName ?? null : null,
        parts: null,
        status: meta.puzzleId ? 'pending' : 'skipped',
        result: null,
        partial: null,
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
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, parts, status, result } : r)))
        setDetail((prev) => {
          if (prev?.rowIndex !== index || detailSourceRef.current !== 'batch') return prev
          return { ...prev, result, partial: prev.partial }
        })
      },
      (done, total) => setProgress({ done, total }),
      (index, partial) => {
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, partial } : r)))
        setDetail((prev) => {
          if (prev?.rowIndex !== index || detailSourceRef.current !== 'batch') return prev
          return { ...prev, partial }
        })
      },
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
    const puzzleMap = await getPuzzleMap().catch(() => null)
    const loaded = await Promise.all(
      files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const id = file.name.replace(/\.puzzle$/i, '')
        const meta = parsePuzzleMeta(bytes)
        const known = puzzleMap?.get(id)
        return { id, name: meta.name, puzzleType: customPuzzleType(meta, known?.id === id ? known.type : undefined), bytes }
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
          result: null,
          partial: null,
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
        const result = await verifyInPool(
          {
            puzzleId: meta.puzzleId as string,
            puzzleType: puzzle.puzzleType,
            solutionBytes: bytes,
            puzzleBytes: puzzle.bytes,
          },
          (partial) => {
            setCustomRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, partial } : r)))
            setDetail((prev) => {
              if (prev?.rowIndex !== i || detailSourceRef.current !== 'custom') return prev
              return { ...prev, partial }
            })
          },
        )
        const parts = result.passed && result.score ? formatScoreParts(result.score, result.puzzleType ?? undefined) : null
        setCustomRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, parts, status: 'done', error: result.passed ? null : result.error, result, partial: r.partial ?? null }
              : r,
          ),
        )
        setDetail((prev) => {
          if (prev?.rowIndex !== i || detailSourceRef.current !== 'custom') return prev
          return { ...prev, result, partial: prev.partial }
        })
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

  const openDetail = useCallback((source: 'batch' | 'custom', index: number, row: Row & { error?: string | null }) => {
    setDetailSource(source)
    setDetail({
      rowIndex: index,
      result: row.result,
      partial: row.partial,
      puzzleId: row.puzzleId,
      puzzleName: row.puzzleName,
      solutionName: row.solutionName,
    })
  }, [])

  const total = progress?.total ?? 0
  const doneCount = progress?.done ?? 0
  const passedCount = rows.filter((r) => r.parts !== null).length
  const failedCount = rows.filter((r) => r.status === 'error' || (r.status === 'done' && r.parts === null)).length

  const cTotal = customProgress?.total ?? 0
  const cDoneCount = customProgress?.done ?? 0
  const cPassedCount = customRows.filter((r) => r.parts !== null).length
  const cFailedCount = customRows.filter((r) => r.status === 'error' || (r.status === 'done' && r.parts === null)).length
  const solDisabled = puzzles.length === 0 || customRunning

  return (
    <div className="tp-page">
      <div className="tp">
        <header className="tp-header">
          <HStack gap={3} vAlign="center">
            <span className="tp-brand-mark" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <VStack gap={0.5}>
              <Heading level={1}>Opus Magnum Batch Verification</Heading>
              <Text type="supporting">
                Verify local .solution files against official or custom .puzzle definitions using the in-browser simulator.
              </Text>
            </VStack>
          </HStack>
          <HStack gap={2} vAlign="center">
            <ThemeModeSwitch />
            <Button
              variant="secondary"
              size="sm"
              href="#/"
              icon={<ArrowLeft size={14} />}
              label="Back to Analyzer"
            />
          </HStack>
        </header>

        <VStack gap={5}>
          <Card padding={5} elevation="low">
            <VStack gap={4}>
              <VStack gap={0.5}>
                <Heading level={2}>Official Puzzle Batch Verification</Heading>
                <Text type="supporting">
                  Drop a folder of .solution files or click below to verify and score all solutions at once.
                </Text>
              </VStack>

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
                  <div className="tp-progress-wrap">
                    <div className="tp-drop-main">Verifying… {doneCount}/{total}</div>
                    <ProgressBar
                      label="Batch verification progress"
                      isLabelHidden
                      value={doneCount}
                      max={Math.max(1, total)}
                      variant="accent"
                    />
                  </div>
                ) : (
                  <>
                    <FolderUp className="tp-drop-icon" strokeWidth={1.6} aria-hidden="true" />
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

              {rows.some((r) => r.status !== 'skipped') && (
                <div className="tp-table-wrap">
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
                      {rows.map((r, i) => r.status === 'skipped' ? null : (
                        <ResultTableRow key={i} row={r} index={i} source="batch" onOpen={openDetail} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </VStack>
          </Card>

          <Card padding={5} elevation="low">
            <VStack gap={4}>
              <VStack gap={0.5}>
                <Heading level={2}>Custom Puzzle Verification</Heading>
                <Text type="supporting">
                  Upload .puzzle files first, then their .solution files. Solutions are matched by the puzzle ID
                  embedded in each file — the .puzzle filename is its ID (e.g. <code>P007.puzzle</code>).
                </Text>
              </VStack>

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
                <Puzzle className="tp-drop-icon" strokeWidth={1.6} aria-hidden="true" />
                <div className="tp-drop-main">Click to select .puzzle files</div>
                <div className="tp-drop-sub">or drag them here</div>
              </div>

              {puzzles.length > 0 && (
                <ul className="tp-puzzles">
                  {puzzles.map((p) => (
                    <li key={p.id} className="tp-puzzle">
                      <Badge variant="info" label={p.id} />
                      <span className="tp-puzzle-name">{p.name ?? '(unknown name)'}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div
                className={`tp-drop tp-drop--small ${solDisabled ? 'is-disabled' : ''} ${isSolOver ? 'is-over' : ''}`}
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
                  <div className="tp-progress-wrap">
                    <div className="tp-drop-main">Verifying… {cDoneCount}/{cTotal}</div>
                    <ProgressBar
                      label="Custom verification progress"
                      isLabelHidden
                      value={cDoneCount}
                      max={Math.max(1, cTotal)}
                      variant="accent"
                    />
                  </div>
                ) : (
                  <>
                    <FileArchive className="tp-drop-icon" strokeWidth={1.6} aria-hidden="true" />
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

              {customRows.some((r) => r.status !== 'skipped') && (
                <div className="tp-table-wrap">
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
                      {customRows.map((r, i) => r.status === 'skipped' ? null : (
                        <ResultTableRow key={i} row={r} index={i} source="custom" onOpen={openDetail} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </VStack>
          </Card>
        </VStack>

        {detail && (
          <SolutionDetailModal
            result={detail.result}
            partial={detail.partial}
            puzzleId={detail.puzzleId}
            puzzleName={detail.puzzleName}
            solutionName={detail.solutionName}
            onClose={() => setDetail(null)}
          />
        )}
      </div>
    </div>
  )
}
