export interface PuzzleMeta {
  name: string | null
  isProduction: boolean
  polymerOutput: boolean
}

class ByteReader {
  private readonly b: Uint8Array
  private off = 0

  constructor(b: Uint8Array) {
    this.b = b
  }

  canRead(n: number): boolean {
    return this.b.length - this.off >= n
  }

  u8(): number | null {
    if (!this.canRead(1)) return null
    return this.b[this.off++]
  }

  u32(): number | null {
    if (!this.canRead(4)) return null
    const v = this.b[this.off] | (this.b[this.off + 1] << 8) | (this.b[this.off + 2] << 16) | (this.b[this.off + 3] << 24)
    this.off += 4
    return v >>> 0
  }

  skip(n: number): boolean {
    if (!this.canRead(n)) return false
    this.off += n
    return true
  }

  varint(): number | null {
    let len = 0
    let shift = 0
    for (;;) {
      const byte = this.u8()
      if (byte === null) return null
      len |= (byte & 0x7f) << shift
      shift += 7
      if (!(byte & 0x80)) break
      if (shift > 28) return null
    }
    return len
  }

  str(): string | null {
    const len = this.varint()
    if (len === null || !this.canRead(len)) return null
    const raw = new TextDecoder('utf-8').decode(this.b.subarray(this.off, this.off + len))
    this.off += len
    const nul = raw.indexOf('\u0000')
    return nul >= 0 ? raw.slice(0, nul) : raw
  }
}

function skipMolecule(r: ByteReader): boolean {
  const atomCount = r.u32()
  if (atomCount === null || !r.skip(atomCount * 3)) return false
  const bondCount = r.u32()
  if (bondCount === null || !r.skip(bondCount * 5)) return false
  return true
}

// Atom type 15 marks a polymer output chain: across all 264 official and
// workshop puzzles it appears exactly in the POLYMER_* types.
function skipMoleculeDetectingPolymer(r: ByteReader): boolean | null {
  const atomCount = r.u32()
  if (atomCount === null) return null
  let polymer = false
  for (let i = 0; i < atomCount; i++) {
    const type = r.u8()
    if (type === null || !r.skip(2)) return null
    if (type === 15) polymer = true
  }
  const bondCount = r.u32()
  if (bondCount === null || !r.skip(bondCount * 5)) return null
  return polymer
}

export function parsePuzzleMeta(puzzleBytes: Uint8Array): PuzzleMeta {
  try {
    const r = new ByteReader(puzzleBytes)
    const version = r.u32()
    if (version !== 3) return { name: null, isProduction: false, polymerOutput: false }
    const name = r.str()
    if (!r.skip(16)) return { name, isProduction: false, polymerOutput: false }
    const inputs = r.u32()
    if (inputs === null) return { name, isProduction: false, polymerOutput: false }
    for (let i = 0; i < inputs; i++) {
      if (!skipMolecule(r)) return { name, isProduction: false, polymerOutput: false }
    }
    const outputs = r.u32()
    if (outputs === null) return { name, isProduction: false, polymerOutput: false }
    let polymerOutput = false
    for (let i = 0; i < outputs; i++) {
      const polymer = skipMoleculeDetectingPolymer(r)
      if (polymer === null) return { name, isProduction: false, polymerOutput }
      polymerOutput = polymerOutput || polymer
    }
    if (r.u32() === null) return { name, isProduction: false, polymerOutput }
    const productionFlag = r.u8()
    return { name, isProduction: productionFlag !== null && productionFlag !== 0, polymerOutput }
  } catch {
    return { name: null, isProduction: false, polymerOutput: false }
  }
}

// The .puzzle format stores no geometry type; the leaderboard API knows every
// official and workshop puzzle. For unknown files only production and the
// polymer marker are derivable.
export function customPuzzleType(meta: PuzzleMeta, apiType?: string): string {
  if (apiType) return apiType
  if (meta.isProduction) return 'PRODUCTION'
  // shortcut: polymer direction (height/width/skew) is not in the file format;
  // unknown polymers keep all geometry measured. Upgrade if a direction parser lands.
  return meta.polymerOutput ? '' : 'NORMAL'
}
