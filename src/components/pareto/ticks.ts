export function formatTick(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e12) {
    const v = n / 1e12
    return Number.isInteger(v) ? `${v}T` : `${v.toFixed(1)}T`
  }
  if (abs >= 1e9) {
    const v = n / 1e9
    return Number.isInteger(v) ? `${v}G` : `${v.toFixed(1)}G`
  }
  if (abs >= 1e6) {
    const v = n / 1e6
    return Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`
  }
  if (abs >= 1e3) {
    const v = n / 1e3
    return Number.isInteger(v) ? `${v}K` : `${v.toFixed(1)}K`
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function generateTicks(domain: [number, number], isInteger: boolean): number[] | undefined {
  const [lo, hi] = domain
  if (lo >= hi) return undefined
  const range = hi - lo
  const rawStep = range / 8
  const mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10))
  const residual = rawStep / mag
  let step = 1
  if (residual <= 1.75) step = mag
  else if (residual <= 3.5) step = 2 * mag
  else if (residual <= 7.5) step = 5 * mag
  else step = 10 * mag
  const minStep = isInteger ? 1 : 0.5
  step = Math.max(minStep, step)
  const first = Math.ceil(lo / step) * step
  const ticks: number[] = []
  for (let t = first; t <= hi + 1e-9; t += step) {
    ticks.push(Math.round(t * 1e10) / 1e10)
  }
  return ticks.length > 1 ? ticks : undefined
}

export function generateLogTicks(domain: [number, number]): number[] | undefined {
  const [lo, hi] = domain
  if (lo >= hi || lo <= 0) return undefined
  const ticks: number[] = []
  const startPow = Math.floor(Math.log10(lo))
  const endPow = Math.ceil(Math.log10(hi))
  for (let p = startPow; p <= endPow; p++) {
    const base = Math.pow(10, p)
    for (const m of [1, 2, 5]) {
      const v = base * m
      if (v >= lo && v <= hi) ticks.push(v)
    }
  }
  return ticks.length > 0 ? ticks : undefined
}

export function niceLinearDomain(max: number, isInteger: boolean): { hi: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { hi: 0, ticks: [0] }
  const rawStep = max / 8
  const mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10))
  const residual = rawStep / mag
  let step = 1
  if (residual <= 1.75) step = mag
  else if (residual <= 3.5) step = 2 * mag
  else if (residual <= 7.5) step = 5 * mag
  else step = 10 * mag
  const minStep = isInteger ? 1 : 0.5
  step = Math.max(minStep, step)
  let hi = Math.ceil(max / step) * step
  if (hi - max <= step * 1e-6) hi += step
  const ticks: number[] = []
  for (let t = 0; t <= hi + 1e-9; t += step) {
    ticks.push(Math.round(t * 1e10) / 1e10)
  }
  return { hi, ticks }
}

export function niceLogDomain(max: number, lo: number): { hi: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { hi: 1, ticks: [] }
  const p = Math.floor(Math.log10(max))
  const base = Math.pow(10, p)
  let hi = base * 10
  for (const m of [1, 2, 5, 10]) {
    const v = base * m
    if (v >= max) { hi = v; break }
  }
  if (hi - max <= max * 1e-6) {
    const mp = Math.floor(Math.log10(hi))
    const bp = Math.pow(10, mp)
    const ratio = hi / bp
    if (ratio <= 1.0000001) hi = bp * 2
    else if (ratio <= 2.0000001) hi = bp * 5
    else hi = bp * 10
  }
  const ticks: number[] = []
  const startPow = Math.floor(Math.log10(lo))
  const endPow = Math.ceil(Math.log10(hi))
  for (let pp = startPow; pp <= endPow; pp++) {
    const b = Math.pow(10, pp)
    for (const m of [1, 2, 5]) {
      const v = b * m
      if (v >= lo && v <= hi) ticks.push(v)
    }
  }
  return { hi, ticks }
}