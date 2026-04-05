// Solidity source-map utilities.
//
// Source-map format (solc): "s:l:f:j:m;s:l:f:j:m;..." — one entry per
// instruction (not per byte). Fields are delta-encoded: empty = "same as
// previous entry."
//   s = byte offset into source
//   l = length in bytes
//   f = source file index (matches `sources[name].id` from solc output)
//   j = jump kind ('i' into, 'o' out of, '-' regular)
//   m = modifier depth

/**
 * Parse a solc source-map string. Returns one entry per instruction.
 */
export function parseSourceMap(mapStr) {
  if (!mapStr) return []
  const entries = []
  let last = { s: -1, l: -1, f: -1, j: '-', m: 0 }
  const segs = mapStr.split(';')
  for (const seg of segs) {
    const parts = seg.split(':')
    const cur = {
      s: parts[0] !== undefined && parts[0] !== '' ? parseInt(parts[0]) : last.s,
      l: parts[1] !== undefined && parts[1] !== '' ? parseInt(parts[1]) : last.l,
      f: parts[2] !== undefined && parts[2] !== '' ? parseInt(parts[2]) : last.f,
      j: parts[3] !== undefined && parts[3] !== '' ? parts[3] : last.j,
      m: parts[4] !== undefined && parts[4] !== '' ? parseInt(parts[4]) : last.m,
    }
    entries.push(cur)
    last = cur
  }
  return entries
}

/**
 * Build a line-start index for fast offset→line lookups.
 * `source[lineIndex[n]]` is the first byte of line (n+1).
 */
export function buildLineIndex(source) {
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1)
  }
  return lineStarts
}

/**
 * Convert a byte offset in the source into { line, col } (1-indexed).
 */
export function offsetToLineCol(lineIndex, offset) {
  let lo = 0, hi = lineIndex.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineIndex[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, col: offset - lineIndex[lo] + 1 }
}

/**
 * Return the line range (startLine..endLine inclusive) covering a span.
 */
export function rangeToLines(lineIndex, start, length) {
  if (start < 0 || length < 0) return null
  const a = offsetToLineCol(lineIndex, start)
  const b = offsetToLineCol(lineIndex, Math.max(start, start + length - 1))
  return { startLine: a.line, endLine: b.line, startCol: a.col, endCol: b.col }
}
