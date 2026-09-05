import type { PartialListener, VerifySolutionResult } from './types'
import { runVerification } from './run'
import { compileVerifierModule } from './verifier'

export interface PoolTask {
  puzzleId: string
  puzzleType: string
  solutionBytes: Uint8Array
  puzzleBytes: Uint8Array
}

type JobResolve = (r: VerifySolutionResult) => void
interface JobCallbacks {
  resolve: JobResolve
  onPartial?: PartialListener
  puzzleId: string
  puzzleType: string
}

let workers: Worker[] = []
let idle: Worker[] = []
const callbacks = new Map<number, JobCallbacks>()
const workerCurrent = new Map<Worker, number>()
let nextId = 0
let initFailed = false
let modulePromise: Promise<WebAssembly.Module> | null = null

type QueuedJob = { task: PoolTask; resolve: JobResolve; onPartial?: PartialListener }
const queue: QueuedJob[] = []

function workerCount(): number {
  return Math.min(Math.max(navigator.hardwareConcurrency ?? 4, 2), 4)
}

function ensurePool(): boolean {
  if (initFailed) return false
  if (workers.length > 0) return true
  try {
    if (!modulePromise) modulePromise = compileVerifierModule()
    const n = workerCount()
    for (let i = 0; i < n; i++) spawnOne()
    return true
  } catch {
    initFailed = true
    return false
  }
}

function spawnOne(): void {
  const w = new Worker(new URL('./verifyWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent) => {
    const data = e.data
    if (data && typeof data.type === 'string' && data.type === 'ready') {
      idle.push(w)
      drain()
      return
    }
    const partial = data as { id: number; partial?: unknown }
    const cb = callbacks.get(partial.id)
    if (!cb) return
    if (partial.partial && typeof partial.partial === 'object') {
      cb.onPartial?.(partial.partial as Parameters<NonNullable<PartialListener>>[0])
      return
    }
    const res = data as { id: number; result: VerifySolutionResult }
    callbacks.delete(res.id)
    cb.resolve(res.result)
    workerCurrent.delete(w)
    idle.push(w)
    drain()
  }
  w.onerror = () => {
    handleWorkerError(w)
  }
  workers.push(w)
  modulePromise!.then(
    (module) => { try { w.postMessage({ type: 'init', module }) } catch { sendInitFallback(w) } },
    () => sendInitFallback(w),
  )
}

function sendInitFallback(w: Worker): void {
  try { w.postMessage({ type: 'init' }) } catch { /* worker dead, onerror will handle */ }
}

function handleWorkerError(w: Worker): void {
  const id = workerCurrent.get(w)
  if (id !== undefined) {
    const cb = callbacks.get(id)
    if (cb) {
      callbacks.delete(id)
      cb.resolve({
        puzzleId: cb.puzzleId,
        puzzleType: cb.puzzleType || null,
        passed: false,
        score: null,
        error: 'worker crashed during verification',
        analysis: null,
      })
    }
  }
  workerCurrent.delete(w)
  const i = idle.indexOf(w)
  if (i >= 0) idle.splice(i, 1)
  workers = workers.filter((x) => x !== w)
  try {
    w.terminate()
  } catch {
    /* ignore */
  }
  if (workers.length === 0) {
    initFailed = true
    flushQueueToMainThread()
  }
}

function flushQueueToMainThread(): void {
  while (queue.length) {
    const job = queue.shift()!
    runOnMainThread(job.task, job.onPartial).then(
      (result) => job.resolve(result),
      () => job.resolve(makeErrorResult(job.task, 'worker failed')),
    )
  }
}

function runOnMainThread(task: PoolTask, onPartial?: PartialListener): Promise<VerifySolutionResult> {
  return runVerification(task.solutionBytes, task.puzzleBytes, task.puzzleType, task.puzzleId, onPartial)
}

function makeErrorResult(task: PoolTask, error: string): VerifySolutionResult {
  return { puzzleId: task.puzzleId, puzzleType: task.puzzleType || null, passed: false, score: null, error, analysis: null }
}

function drain(): void {
  while (queue.length && idle.length) {
    const job = queue.shift()!
    const w = idle.pop()!
    dispatch(w, job.task, job.resolve, job.onPartial)
  }
}

function dispatch(w: Worker, task: PoolTask, resolve: JobResolve, onPartial?: PartialListener): void {
  const id = nextId++
  callbacks.set(id, { resolve, onPartial, puzzleId: task.puzzleId, puzzleType: task.puzzleType })
  workerCurrent.set(w, id)
  const msg = {
    id,
    puzzleId: task.puzzleId,
    puzzleType: task.puzzleType,
    solutionBytes: task.solutionBytes,
    puzzleBytes: task.puzzleBytes,
  }
  const buffer = task.solutionBytes.buffer
  try {
    w.postMessage(msg, [buffer])
  } catch {
    w.postMessage(msg)
  }
}

export function verifyInPool(task: PoolTask, onPartial?: PartialListener): Promise<VerifySolutionResult> {
  if (!ensurePool()) {
    return runOnMainThread(task, onPartial).catch((err) =>
      makeErrorResult(task, err instanceof Error ? err.message : String(err)),
    )
  }
  if (idle.length) {
    const w = idle.pop()!
    return new Promise((resolve) => dispatch(w, task, resolve, onPartial))
  }
  return new Promise((resolve) => queue.push({ task, resolve, onPartial }))
}

