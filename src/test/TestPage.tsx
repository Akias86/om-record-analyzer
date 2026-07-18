import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { parseSolutionMeta, formatFullScore, verifyBatch } from '../lib/verify'
import type { BatchInput } from '../lib/verify'

type RowStatus = 'pending' | 'verifying' | 'done' | 'error' | 'skipped'

interface Row {
  fileName: string
  solutionName: string | null
  puzzleId: string | null
  fullScore: string | null
  status: RowStatus
}

export default function TestPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [])

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const all = Array.from(fileList).filter((f) => f.name.endsWith('.solution'))
    if (all.length === 0) return
    all.sort((a, b) => a.name.localeCompare(b.name))

    setRunning(true)
    setProgress({ done: 0, total: all.length })

    const inputs: BatchInput[] = []
    const initial: Row[] = []
    for (const file of all) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const meta = parseSolutionMeta(bytes)
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const total = progress?.total ?? 0
  const doneCount = progress?.done ?? 0
  const passedCount = rows.filter((r) => r.fullScore !== null).length
  const failedCount = rows.filter((r) => r.status === 'error' || (r.status === 'done' && r.fullScore === null)).length

  return (
    <div className="tp">
      <h1 className="tp-title">Opus Magnum Batch Verification</h1>
      <p className="tp-sub">Select a folder containing .solution files, auto-verify all · <a href="#/">Back</a></p>

      <div
        className={`tp-drop ${running ? 'is-disabled' : ''}`}
        onDragOver={(e) => { if (!running) e.preventDefault() }}
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
        {running
          ? `Verifying... ${doneCount}/${total}`
          : 'Click to select folder, or drag .solution files here'}
      </div>

      {progress && (
        <div className="tp-progress">
          Total {total} files · Passed {passedCount} · Failed/Empty {failedCount}
        </div>
      )}

      {rows.length > 0 && (
        <table className="tp-batch-table">
          <thead>
            <tr>
              <th>Save Name</th>
              <th>Level ID</th>
              <th>fullFormattedScore</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`tp-row tp-row--${r.status}`}>
                <td className="tp-cell-name">{r.solutionName ?? ''}</td>
                <td className="tp-cell-id">{r.puzzleId ?? ''}</td>
                <td className="tp-cell-score">
                  {r.status === 'verifying' ? <span className="tp-spin">…</span> : (r.fullScore ?? '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
