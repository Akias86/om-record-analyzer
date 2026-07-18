import { loadVerifier } from './verifier'
import { runVerification } from './run'
import type { VerifySolutionResult } from './types'

type InMessage =
  | { type: 'init'; module?: WebAssembly.Module }
  | { id: number; puzzleId: string; puzzleType: string; solutionBytes: Uint8Array; puzzleBytes: Uint8Array }

interface WorkerResponse {
  id: number
  result: VerifySolutionResult
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<InMessage>) => void) | null
  postMessage(message: WorkerResponse | { type: 'ready' }): void
}

ctx.onmessage = async (ev: MessageEvent<InMessage>) => {
  const msg = ev.data
  if ('type' in msg && msg.type === 'init') {
    try {
      await loadVerifier(msg.module)
    } catch {
      /* worker will self-compile on first task via loadVerifier() */
    }
    ctx.postMessage({ type: 'ready' })
    return
  }
  const t = msg as { id: number; puzzleId: string; puzzleType: string; solutionBytes: Uint8Array; puzzleBytes: Uint8Array }
  const { id, puzzleId, puzzleType, solutionBytes, puzzleBytes } = t
  try {
    const result = await runVerification(solutionBytes, puzzleBytes, puzzleType, puzzleId)
    ctx.postMessage({ id, result })
  } catch (err) {
    ctx.postMessage({
      id,
      result: {
        puzzleId,
        puzzleType: puzzleType || null,
        passed: false,
        score: null,
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }
}
