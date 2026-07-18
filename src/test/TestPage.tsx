import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { verifySolution, parseSolutionMeta, formatFullScore } from '../lib/verify'

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

    const cached: { bytes: Uint8Array }[] = []
    const initial: Row[] = []
    for (const file of all) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      cached.push({ bytes })
      const meta = parseSolutionMeta(bytes)
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
    let done = 0
    for (const i of pendingIndices) {
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'verifying' } : r)))
      try {
        const result = await verifySolution(cached[i].bytes)
        const fullScore = result.passed && result.score
          ? formatFullScore(result.score, result.puzzleType ?? undefined)
          : null
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, fullScore, status: 'done' } : r)))
      } catch {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'error' } : r)))
      }
      done++
      setProgress({ done, total: all.length })
    }

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
      <h1 className="tp-title">Opus Magnum 批量验证</h1>
      <p className="tp-sub">选择包含 .solution 文件的文件夹，自动验证全部 · <a href="#/">返回</a></p>

      <div
        className={`tp-drop ${running ? 'is-disabled' : ''}`}
        onDragOver={(e) => { if (!running) e.preventDefault() }}
        onDrop={onDrop}
        onClick={() => { if (!running) inputRef.current?.click() }}
      >
        <input
          ref={inputRef}
          type="file"
          className="tp-file"
          multiple
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
        />
        {running
          ? `验证中… ${doneCount}/${total}`
          : '点击选择文件夹，或拖入 .solution 文件'}
      </div>

      {progress && (
        <div className="tp-progress">
          共 {total} 个文件 · 通过 {passedCount} · 失败/留空 {failedCount}
        </div>
      )}

      {rows.length > 0 && (
        <table className="tp-batch-table">
          <thead>
            <tr>
              <th>存档名称</th>
              <th>关卡 ID</th>
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
