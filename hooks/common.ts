// Shared by every diagram: the art type, character width, colors and small text helpers. Pure functions, no I/O.

export type Seg = { text: string; color?: string }
export type Art = { lines: Seg[][]; plain: string; width: number }

export const PALETTE = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f5c2e7', '#94e2d5', '#fab387', '#cba6f7', '#f38ba8']
export const DIM = '#6c7086'
export const LINE = '#89b4fa'
export const ARROW = '#cba6f7'
export const TITLE = '#f9e2af'

// ---------------------------------------------------------------- width

export function cpWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp >= 0x0300 && cp <= 0x036f) return 0
  if (cp === 0x200b || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2
  return 1
}

export function strWidth(s: string): number {
  let w = 0
  for (const ch of s) w += cpWidth(ch.codePointAt(0) ?? 0)
  return w
}

// ---------------------------------------------------------------- text helpers

/** Source lines with comments and init directives removed, blank lines dropped. */
export function srcLines(src: string): string[] {
  return src
    .split(/\r?\n/)
    .map(l => l.replace(/%%.*$/, '').replace(/\s+$/, ''))
    .filter(l => l.trim())
}

/** The diagram keyword on the first real line. */
export function diagramKind(src: string): string {
  const first = srcLines(src)[0]?.trim() ?? ''
  return /^[\w-]+/.exec(first)?.[0] ?? ''
}

export function clean(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/#quot;|&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function unquote(s: string): string {
  const t = s.trim()
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t
}

export function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - strWidth(s)))
}

export function cut(s: string, w: number): string {
  if (strWidth(s) <= w) return s
  let out = ''
  for (const ch of s) {
    if (strWidth(out + ch) > w - 1) break
    out += ch
  }
  return out + '…'
}

export function toArt(lines: Seg[][]): Art {
  const merged = lines.map(l => {
    const out: Seg[] = []
    for (const s of l) {
      if (!s.text) continue
      const prev = out[out.length - 1]
      if (prev && prev.color === s.color) prev.text += s.text
      else out.push({ ...s })
    }
    const last = out[out.length - 1]
    if (last) last.text = last.text.replace(/\s+$/, '')
    return out.filter(s => s.text)
  })
  const plain = merged.map(l => l.map(s => s.text).join(''))
  return { lines: merged, plain: plain.join('\n'), width: Math.max(0, ...plain.map(strWidth)) }
}

/** A grid of cells. A wide char takes two cells, the second one holds ''. */
export class TextCanvas {
  rows: { ch: string; color?: string }[][] = []
  width: number
  constructor(width: number) {
    this.width = width
  }
  row(y: number) {
    while (this.rows.length <= y) this.rows.push(Array.from({ length: this.width }, () => ({ ch: ' ' })))
    return this.rows[y]
  }
  put(x: number, y: number, s: string, color?: string) {
    const r = this.row(y)
    for (const ch of s) {
      const w = strWidth(ch)
      if (x + w > this.width) {
        r.push(...Array.from({ length: x + w - this.width }, () => ({ ch: ' ' })))
      }
      r[x] = { ch, color }
      if (w === 2) r[x + 1] = { ch: '', color }
      x += w
    }
  }
  get(x: number, y: number) {
    return this.row(y)[x]?.ch
  }
  art(): Art {
    return toArt(this.rows.map(r => r.map(c => ({ text: c.ch, color: c.color }))))
  }
}
