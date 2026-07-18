import { prefetchPuzzles } from './puzzle'
import { verifyInPool } from './workerPool'
import type { VerifySolutionResult } from './types'

export interface BatchInput {
  bytes: Uint8Array
  puzzleId: string | null
}

const SKIP_NO_PUZZLE: VerifySolutionResult = {
  puzzleId: null,
  puzzleType: null,
  passed: false,
  score: null,
  error: 'Could not identify puzzle from solution file',
}

export async function verifyBatch(
  inputs: BatchInput[],
  onResult?: (index: number, result: VerifySolutionResult) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<VerifySolutionResult[]> {
  const results: VerifySolutionResult[] = new Array(inputs.length)
  const validIndices: number[] = []
  const validPuzzleIds = new Set<string>()
  const total = inputs.length
  let done = 0

  const report = (index: number, result: VerifySolutionResult): void => {
    results[index] = result
    done++
    onResult?.(index, result)
    onProgress?.(done, total)
  }

  for (let i = 0; i < inputs.length; i++) {
    const { puzzleId } = inputs[i]
    if (!puzzleId) {
      report(i, SKIP_NO_PUZZLE)
      continue
    }
    validIndices.push(i)
    validPuzzleIds.add(puzzleId)
  }

  if (validIndices.length === 0) return results

  const { bytes: puzzleBytesMap, types: puzzleTypeMap } = await prefetchPuzzles(validPuzzleIds)

  await Promise.all(
    validIndices.map(async (i) => {
      const { bytes: solutionBytes, puzzleId } = inputs[i]
      const pid = puzzleId as string
      const puzzleBytes = puzzleBytesMap.get(pid)
      if (!puzzleBytes) {
        report(i, {
          puzzleId: pid,
          puzzleType: puzzleTypeMap.get(pid) || null,
          passed: false,
          score: null,
          error: `puzzle file not found: ${pid}`,
        })
        return
      }
      const puzzleType = puzzleTypeMap.get(pid) ?? ''
      const result = await verifyInPool({ puzzleId: pid, puzzleType, solutionBytes, puzzleBytes })
      report(i, result)
    }),
  )

  return results
}
