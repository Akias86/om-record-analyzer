interface VerifierExports {
  _initialize?: () => void
  malloc: (n: number) => number
  free: (ptr: number) => void
  memory: WebAssembly.Memory
  verifier_create_from_bytes: (pp: number, pl: number, sp: number, sl: number) => number
  verifier_error: (v: number) => number
  verifier_error_clear: (v: number) => void
  verifier_error_cycle: (v: number) => number
  verifier_error_source: (v: number) => number
  verifier_error_location_u: (v: number) => number
  verifier_error_location_v: (v: number) => number
  verifier_number_of_output_intervals: (v: number) => number
  verifier_output_interval: (v: number, which: number) => number
  verifier_output_intervals_repeat_after: (v: number) => number
  verifier_set_cycle_limit: (v: number, limit: number) => void
  verifier_destroy: (v: number) => void
  verifier_evaluate_approximate_metric: (v: number, mp: number) => number
  verifier_wrong_output_index: (v: number) => number
}

export interface VerifierErrorInfo {
  source: string | null
  cycle: number
  location: { u: number; v: number }
}

export interface OutputIntervals {
  count: number
  intervals: number[]
  repeatAfter: number
}

export interface VerifierModule {
  create(puzzle: Uint8Array, solution: Uint8Array): number
  error(v: number): string | null
  errorInfo(v: number): VerifierErrorInfo | null
  clearError(v: number): void
  evaluate(v: number, metric: string): number
  outputIntervals(v: number): OutputIntervals
  setCycleLimit(v: number, limit: number): void
  wrongOutputIndex(v: number): number
  destroy(v: number): void
}

let modulePromise: Promise<WebAssembly.Module> | null = null
let instancePromise: Promise<VerifierModule> | null = null

export function compileVerifierModule(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const url = new URL('./libverify.wasm', import.meta.url)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`failed to load libverify.wasm: ${res.status}`)
      return WebAssembly.compile(await res.arrayBuffer())
    })()
    modulePromise.catch(() => { modulePromise = null })
  }
  return modulePromise
}

export function loadVerifier(module?: WebAssembly.Module): Promise<VerifierModule> {
  if (!instancePromise) {
    instancePromise = init(module)
    instancePromise.catch(() => { instancePromise = null })
  }
  return instancePromise
}

async function init(module?: WebAssembly.Module): Promise<VerifierModule> {
  const mod = module ?? await compileVerifierModule()
  const instance = await WebAssembly.instantiate(mod, {
    env: { emscripten_notify_memory_growth: () => {} },
  })
  const e = instance.exports as unknown as VerifierExports
  e._initialize?.()

  const view = (): Uint8Array => new Uint8Array(e.memory.buffer)
  const writeBytes = (b: Uint8Array): number => {
    const ptr = e.malloc(b.byteLength)
    new Uint8Array(e.memory.buffer, ptr, b.byteLength).set(b)
    return ptr
  }
  const writeCStr = (s: string): number => writeBytes(new TextEncoder().encode(s + '\0'))
  const readCStr = (ptr: number): string | null => {
    if (ptr === 0) return null
    const m = view()
    let end = ptr
    while (m[end] !== 0) end++
    return new TextDecoder('latin1').decode(m.subarray(ptr, end))
  }

  return {
    create(puzzle, solution) {
      const pp = writeBytes(puzzle)
      const sp = writeBytes(solution)
      const ptr = e.verifier_create_from_bytes(pp, puzzle.byteLength, sp, solution.byteLength)
      e.free(pp)
      e.free(sp)
      return ptr
    },
    error(v) {
      return readCStr(e.verifier_error(v))
    },
    errorInfo(v) {
      if (readCStr(e.verifier_error(v)) === null) return null
      return {
        source: readCStr(e.verifier_error_source(v)),
        cycle: e.verifier_error_cycle(v),
        location: { u: e.verifier_error_location_u(v), v: e.verifier_error_location_v(v) },
      }
    },
    clearError(v) {
      e.verifier_error_clear(v)
    },
    evaluate(v, metric) {
      const mp = writeCStr(metric)
      const value = e.verifier_evaluate_approximate_metric(v, mp)
      e.free(mp)
      return value
    },
    outputIntervals(v) {
      const count = e.verifier_number_of_output_intervals(v)
      const intervals: number[] = []
      for (let i = 0; i < count; i++) intervals.push(e.verifier_output_interval(v, i))
      return { count, intervals, repeatAfter: e.verifier_output_intervals_repeat_after(v) }
    },
    setCycleLimit(v, limit) {
      e.verifier_set_cycle_limit(v, limit)
    },
    wrongOutputIndex(v) {
      return e.verifier_wrong_output_index(v)
    },
    destroy(v) {
      e.verifier_destroy(v)
    },
  }
}
