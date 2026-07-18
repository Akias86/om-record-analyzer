import type { VerifySolutionResult } from './types'
import { runVerification } from './run'
import { compileVerifierModule } from './verifier'

export interface PoolTask {
  puzzleId: string
  puzzleType: string
  solutionBytes: Uint8Array
  puzzleBytes: Uint8Array
}

let workers: Worker[] = []
let idle: Worker[] = []
const callbacks = new Map<number, { resolve: (r: VerifySolutionResult) => void; puzzleId: string; puzzleType: string }>()
const workerCurrent = new Map<Worker, number>()
let nextId = 0
let initFailed = false
let modulePromise: Promise<WebAssembly.Module> | null = null

type QueuedJob = { task: PoolTask; resolve: (r: VerifySolutionResult) => void }
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
    const res = data as { id: number; result: VerifySolutionResult }
    const cb = callbacks.get(res.id)
    if (cb) {
      callbacks.delete(res.id)
      cb.resolve(res.result)
    }
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
    runOnMainThread(job.task).then(
      (result) => job.resolve(result),
      () => job.resolve(makeErrorResult(job.task, 'worker failed')),
    )
  }
}

function runOnMainThread(task: PoolTask): Promise<VerifySolutionResult> {
  return runVerification(task.solutionBytes, task.puzzleBytes, task.puzzleType, task.puzzleId)
}

function makeErrorResult(task: PoolTask, error: string): VerifySolutionResult {
  return { puzzleId: task.puzzleId, puzzleType: task.puzzleType || null, passed: false, score: null, error }
}

function drain(): void {
  while (queue.length && idle.length) {
    const job = queue.shift()!
    const w = idle.pop()!
    dispatch(w, job.task, job.resolve)
  }
}

function dispatch(w: Worker, task: PoolTask, resolve: (r: VerifySolutionResult) => void): void {
  const id = nextId++
  callbacks.set(id, { resolve, puzzleId: task.puzzleId, puzzleType: task.puzzleType })
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

export function verifyInPool(task: PoolTask): Promise<VerifySolutionResult> {
  if (!ensurePool()) {
    return runOnMainThread(task).catch((err) =>
      makeErrorResult(task, err instanceof Error ? err.message : String(err)),
    )
  }
  if (idle.length) {
    const w = idle.pop()!
    return new Promise((resolve) => dispatch(w, task, resolve))
  }
  return new Promise((resolve) => queue.push({ task, resolve }))
}

export function terminatePool(): void {
  for (const w of workers) {
    try {
      w.terminate()
    } catch {
      /* ignore */
    }
  }
  workers = []
  idle = []
  callbacks.clear()
  workerCurrent.clear()
  queue.length = 0
}
