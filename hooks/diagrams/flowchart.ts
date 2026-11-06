// Mermaid flowchart -> colored box-drawing text. Pure functions, no I/O.

import type { Art, Seg } from '../common'
import { PALETTE, cpWidth, strWidth } from '../common'

function wrapLabel(label: string, max: number): string[] {
  const out: string[] = []
  for (const raw of label.split('\n')) {
    const line = raw.trim()
    if (strWidth(line) <= max) {
      out.push(line)
      continue
    }
    let cur = ''
    let curW = 0
    // tokens: words for latin, single chars for wide chars
    const tokens = line.match(/[ᄀ-￿]|[^\sᄀ-￿]+|\s+/gu) ?? []
    for (const t of tokens) {
      const tw = strWidth(t)
      if (/^\s+$/.test(t)) {
        if (cur && curW + 1 <= max) {
          cur += ' '
          curW += 1
        }
        continue
      }
      if (curW + tw > max && cur.trim()) {
        out.push(cur.trimEnd())
        cur = ''
        curW = 0
      }
      cur += t
      curW += tw
    }
    if (cur.trim()) out.push(cur.trimEnd())
  }
  return out.length ? out : ['']
}

// ---------------------------------------------------------------- parse

type Shape = 'rect' | 'round' | 'diamond' | 'double'
type LineStyle = 'solid' | 'dotted' | 'thick'
type Dir = 'TD' | 'LR'
type GNode = { id: string; label: string; shape: Shape; idx: number }
type GEdge = { from: string; to: string; label: string; style: LineStyle; head: boolean; tail: boolean }
type Graph = { dir: Dir; nodes: Map<string, GNode>; edges: GEdge[] }

const ID_RE = /^[\p{L}\p{N}_]+(?:-(?![-.>])[\p{L}\p{N}_]+)*/u

const SHAPES: [string, string[], Shape][] = [
  ['(((', [')))'], 'round'],
  ['((', ['))'], 'round'],
  ['([', ['])'], 'round'],
  ['[[', [']]'], 'double'],
  ['[(', [')]'], 'round'],
  ['{{', ['}}'], 'diamond'],
  ['[/', ['/]', '\\]'], 'rect'],
  ['[\\', ['\\]', '/]'], 'rect'],
  ['[', [']'], 'rect'],
  ['(', [')'], 'round'],
  ['{', ['}'], 'diamond'],
  ['>', [']'], 'rect'],
]

function cleanLabel(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/#quot;|&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\n/g, '\n')
    .trim()
}

function splitStatements(line: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (const ch of line) {
    if (ch === '"') quote = !quote
    else if (!quote && '[({'.includes(ch)) depth++
    else if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0 && !quote) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++
  return i
}

function ensureNode(g: Graph, id: string): GNode {
  let n = g.nodes.get(id)
  if (!n) {
    n = { id, label: id, shape: 'rect', idx: g.nodes.size }
    g.nodes.set(id, n)
  }
  return n
}

function parseNode(s: string, i: number, g: Graph): { id: string; end: number } | null {
  const m = ID_RE.exec(s.slice(i))
  if (!m) return null
  const id = m[0]
  let j = i + id.length
  const node = ensureNode(g, id)
  for (const [open, closes, shape] of SHAPES) {
    if (!s.startsWith(open, j)) continue
    let k = j + open.length
    let label: string | null = null
    let end = -1
    if (s[k] === '"') {
      const q = s.indexOf('"', k + 1)
      if (q < 0) continue
      label = s.slice(k + 1, q)
      const after = skipWs(s, q + 1)
      for (const c of closes) if (s.startsWith(c, after)) end = after + c.length
    } else {
      let best = -1
      let bestLen = 0
      for (const c of closes) {
        const idx = s.indexOf(c, k)
        if (idx >= 0 && (best < 0 || idx < best)) {
          best = idx
          bestLen = c.length
        }
      }
      if (best >= 0) {
        label = s.slice(k, best)
        end = best + bestLen
      }
    }
    if (label === null || end < 0) continue
    node.label = cleanLabel(label) || id
    node.shape = shape
    j = end
    break
  }
  const cls = /^:::[\w-]+/.exec(s.slice(j))
  if (cls) j += cls[0].length
  return { id, end: j }
}

function parseGroup(s: string, i: number, g: Graph): { ids: string[]; end: number } | null {
  const first = parseNode(s, i, g)
  if (!first) return null
  const ids = [first.id]
  let end = first.end
  for (;;) {
    const k = skipWs(s, end)
    if (s[k] !== '&') break
    const next = parseNode(s, skipWs(s, k + 1), g)
    if (!next) break
    ids.push(next.id)
    end = next.end
  }
  return { ids, end }
}

const LABELED = /^(--|==|-\.)\s+(\S[^|]*?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+)/
const SIMPLE = /^(<)?(-\.+-|-{2,}|={2,})(>|x|o)?/
const PIPE = /^\s*\|([^|]*)\|/

function edgeStyle(tok: string): LineStyle {
  if (tok.includes('.')) return 'dotted'
  if (tok.includes('=')) return 'thick'
  return 'solid'
}

function parseEdge(
  s: string,
  i: number,
): { end: number; label: string; style: LineStyle; head: boolean; tail: boolean } | null {
  const rest = s.slice(i)
  const lm = LABELED.exec(rest)
  if (lm) {
    return {
      end: i + lm[0].length,
      label: cleanLabel(lm[2]),
      style: edgeStyle(lm[1] + lm[3]),
      head: lm[3].endsWith('>'),
      tail: false,
    }
  }
  const sm = SIMPLE.exec(rest)
  if (!sm) return null
  let end = i + sm[0].length
  let label = ''
  const pm = PIPE.exec(s.slice(end))
  if (pm) {
    label = cleanLabel(pm[1])
    end += pm[0].length
  }
  return { end, label, style: edgeStyle(sm[2]), head: !!sm[3], tail: !!sm[1] }
}

const SKIP = /^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/

export function parseFlowchart(src: string): Graph | null {
  const lines = src.split(/\r?\n/).map(l => l.replace(/%%.*$/, ''))
  let g: Graph | null = null
  for (const line of lines) {
    for (const raw of splitStatements(line)) {
      const st = raw.trim()
      if (!st) continue
      if (!g) {
        const hm = /^(graph|flowchart)\b\s*(TB|TD|BT|RL|LR)?\s*$/i.exec(st)
        if (!hm) return null
        const d = (hm[2] ?? 'TD').toUpperCase()
        g = { dir: d === 'LR' || d === 'RL' ? 'LR' : 'TD', nodes: new Map(), edges: [] }
        continue
      }
      if (SKIP.test(st)) continue
      let i = skipWs(st, 0)
      let left = parseGroup(st, i, g)
      if (!left) continue
      i = left.end
      for (;;) {
        i = skipWs(st, i)
        if (i >= st.length) break
        const ed = parseEdge(st, i)
        if (!ed) break
        i = skipWs(st, ed.end)
        const right = parseGroup(st, i, g)
        if (!right) break
        for (const a of left.ids)
          for (const b of right.ids)
            g.edges.push({ from: a, to: b, label: ed.label, style: ed.style, head: ed.head, tail: ed.tail })
        left = right
        i = right.end
      }
    }
  }
  if (!g || g.nodes.size === 0) return null
  return g
}

// ---------------------------------------------------------------- layout

const LINE_COLOR = '#89b4fa'
const ARROW_COLOR = '#cba6f7'
const LABEL_COLOR = 'text'

type LNode = {
  id: string
  real: boolean
  lines: string[]
  shape: Shape
  color: string
  layer: number
  order: number
  w: number
  h: number
  x: number
  y: number
}
// arrowV: arrow at the v end (bottom / right); arrowU: at the u end (top / left)
type Link = {
  u: LNode
  v: LNode
  style: LineStyle
  label: string
  arrowU: boolean
  arrowV: boolean
  isFirst: boolean
  isLast: boolean
}

type Layout = { layers: LNode[][]; links: Link[] }

function straightenDummies(layers: LNode[][], chains: LNode[][], pos: (n: LNode) => number, set: (n: LNode, p: number) => void, size: (n: LNode) => number, gap: number) {
  for (const chain of chains) {
    if (chain.length < 2) continue
    const target = Math.max(...chain.map(pos))
    for (const d of chain) {
      const ly = layers[d.layer]
      const nextN = ly[d.order + 1]
      const prevN = ly[d.order - 1]
      const fitsRight = !nextN || pos(nextN) >= target + size(d) + gap
      const fitsLeft = !prevN || pos(prevN) + size(prevN) + gap <= target
      if (fitsRight && fitsLeft) set(d, target)
    }
  }
}

function buildLayers(g: Graph, maxLabel: number): Layout & { chains: LNode[][] } {
  const ids = [...g.nodes.keys()]
  const edges = g.edges.filter(e => e.from !== e.to)
  const out = new Map<string, number[]>()
  ids.forEach(id => out.set(id, []))
  edges.forEach((e, k) => out.get(e.from)!.push(k))

  // cycle breaking
  const state = new Map<string, number>()
  const reversed = new Set<number>()
  const visit = (u: string) => {
    state.set(u, 1)
    for (const k of out.get(u)!) {
      const v = edges[k].to
      const s = state.get(v) ?? 0
      if (s === 1) reversed.add(k)
      else if (s === 0) visit(v)
    }
    state.set(u, 2)
  }
  ids.forEach(id => {
    if (!state.get(id)) visit(id)
  })

  // longest-path layering
  const dag = edges.map((e, k) => (reversed.has(k) ? { u: e.to, v: e.from, k } : { u: e.from, v: e.to, k }))
  const indeg = new Map<string, number>()
  ids.forEach(id => indeg.set(id, 0))
  dag.forEach(d => indeg.set(d.v, indeg.get(d.v)! + 1))
  const layer = new Map<string, number>()
  ids.forEach(id => layer.set(id, 0))
  const queue = ids.filter(id => indeg.get(id) === 0)
  while (queue.length) {
    const u = queue.shift()!
    for (const d of dag) {
      if (d.u !== u) continue
      layer.set(d.v, Math.max(layer.get(d.v)!, layer.get(u)! + 1))
      indeg.set(d.v, indeg.get(d.v)! - 1)
      if (indeg.get(d.v) === 0) queue.push(d.v)
    }
  }

  const lnodes = new Map<string, LNode>()
  const layers: LNode[][] = []
  const add = (n: LNode) => {
    while (layers.length <= n.layer) layers.push([])
    n.order = layers[n.layer].length
    layers[n.layer].push(n)
  }
  ids.forEach((id, i) => {
    const gn = g.nodes.get(id)!
    const n: LNode = {
      id,
      real: true,
      lines: wrapLabel(gn.label, maxLabel),
      shape: gn.shape,
      color: PALETTE[i % PALETTE.length],
      layer: layer.get(id)!,
      order: 0,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
    }
    lnodes.set(id, n)
    add(n)
  })

  // merge edges joining the same pair (either direction) into one drawn line
  type Merged = { u: string; v: string; style: LineStyle; label: string; arrowU: boolean; arrowV: boolean }
  const merged = new Map<string, Merged>()
  for (const d of dag) {
    const e = edges[d.k]
    const rev = reversed.has(d.k)
    const aV = rev ? e.tail : e.head
    const aU = rev ? e.head : e.tail
    const key = `${d.u}\u0000${d.v}`
    const m = merged.get(key)
    if (m) {
      m.arrowU ||= aU
      m.arrowV ||= aV
      if (e.label && !m.label.split(' / ').includes(e.label)) m.label = m.label ? `${m.label} / ${e.label}` : e.label
    } else merged.set(key, { u: d.u, v: d.v, style: e.style, label: e.label, arrowU: aU, arrowV: aV })
  }

  const links: Link[] = []
  const chains: LNode[][] = []
  let dummyId = 0
  for (const d of merged.values()) {
    let prev = lnodes.get(d.u)!
    const target = lnodes.get(d.v)!
    const chain: LNode[] = [prev]
    for (let L = prev.layer + 1; L < target.layer; L++) {
      const dn: LNode = {
        id: `__d${dummyId++}`,
        real: false,
        lines: [],
        shape: 'rect',
        color: LINE_COLOR,
        layer: L,
        order: 0,
        w: 1,
        h: 1,
        x: 0,
        y: 0,
      }
      add(dn)
      chain.push(dn)
    }
    chain.push(target)
    if (chain.length > 2) chains.push(chain.slice(1, -1))
    for (let c = 0; c + 1 < chain.length; c++) {
      links.push({
        u: chain[c],
        v: chain[c + 1],
        style: d.style,
        label: c + 2 === chain.length ? d.label : '',
        arrowU: c === 0 && d.arrowU,
        arrowV: c + 2 === chain.length && d.arrowV,
        isFirst: c === 0,
        isLast: c + 2 === chain.length,
      })
    }
    void prev
  }

  // barycenter ordering
  const preds = new Map<LNode, LNode[]>()
  const succs = new Map<LNode, LNode[]>()
  for (const l of links) {
    if (!preds.has(l.v)) preds.set(l.v, [])
    if (!succs.has(l.u)) succs.set(l.u, [])
    preds.get(l.v)!.push(l.u)
    succs.get(l.u)!.push(l.v)
  }
  const sortLayer = (ly: LNode[], nb: Map<LNode, LNode[]>) => {
    const bc = new Map<LNode, number>()
    for (const n of ly) {
      const ns = nb.get(n)
      bc.set(n, ns && ns.length ? ns.reduce((a, b) => a + b.order, 0) / ns.length : n.order)
    }
    ly.sort((a, b) => bc.get(a)! - bc.get(b)! || a.order - b.order)
    ly.forEach((n, i) => (n.order = i))
  }
  for (let it = 0; it < 6; it++) {
    for (let L = 1; L < layers.length; L++) sortLayer(layers[L], preds)
    for (let L = layers.length - 2; L >= 0; L--) sortLayer(layers[L], succs)
  }

  return { layers, links, chains }
}

// greedy 1-D placement along the cross axis
function placeAxis(
  layers: LNode[][],
  links: Link[],
  size: (n: LNode) => number,
  gap: (a: LNode, b: LNode) => number,
  setPos: (n: LNode, p: number) => void,
  getPos: (n: LNode) => number,
) {
  const center = (n: LNode) => getPos(n) + Math.floor(size(n) / 2)
  const preds = new Map<LNode, LNode[]>()
  const succs = new Map<LNode, LNode[]>()
  for (const l of links) {
    if (!preds.has(l.v)) preds.set(l.v, [])
    if (!succs.has(l.u)) succs.set(l.u, [])
    preds.get(l.v)!.push(l.u)
    succs.get(l.u)!.push(l.v)
  }
  // initial: sequential
  for (const ly of layers) {
    let c = 0
    ly.forEach((n, i) => {
      if (i > 0) c += gap(ly[i - 1], n)
      setPos(n, c)
      c += size(n)
    })
  }
  const pass = (ly: LNode[], nb: Map<LNode, LNode[]>) => {
    let cursor = -Infinity
    ly.forEach((n, i) => {
      const ns = nb.get(n)
      const want = ns && ns.length ? ns.reduce((a, b) => a + center(b), 0) / ns.length - Math.floor(size(n) / 2) : getPos(n)
      const minP = i === 0 ? -Infinity : cursor + gap(ly[i - 1], n)
      const p = Math.max(minP, Math.round(want))
      setPos(n, p)
      cursor = p + size(n)
    })
  }
  for (let r = 0; r < 2; r++) {
    for (let L = 1; L < layers.length; L++) pass(layers[L], preds)
    for (let L = layers.length - 2; L >= 0; L--) pass(layers[L], succs)
  }
  for (let L = 1; L < layers.length; L++) pass(layers[L], preds)
  let min = Infinity
  for (const ly of layers) for (const n of ly) min = Math.min(min, getPos(n))
  for (const ly of layers) for (const n of ly) setPos(n, getPos(n) - min)
}

// ---------------------------------------------------------------- canvas

const U = 1,
  D = 2,
  L_ = 4,
  R = 8

type Cell = { ch: string | null; color?: string; bits: number; style: LineStyle; lineColor?: string }

class Canvas {
  rows: Cell[][] = []
  cell(x: number, y: number): Cell {
    while (this.rows.length <= y) this.rows.push([])
    const row = this.rows[y]
    while (row.length <= x) row.push({ ch: null, bits: 0, style: 'solid' })
    return row[x]
  }
  line(x: number, y: number, bits: number, style: LineStyle) {
    if (x < 0 || y < 0) return
    const c = this.cell(x, y)
    c.bits |= bits
    if (style !== 'solid') c.style = style
    c.lineColor = LINE_COLOR
  }
  put(x: number, y: number, ch: string, color?: string) {
    if (x < 0 || y < 0) return
    const c = this.cell(x, y)
    c.ch = ch
    c.color = color
  }
  text(x: number, y: number, s: string, color?: string) {
    let cx = x
    for (const ch of s) {
      const w = cpWidth(ch.codePointAt(0) ?? 0)
      if (w === 0) continue
      this.put(cx, y, ch, color)
      if (w === 2) this.put(cx + 1, y, '', color)
      cx += w
    }
  }
  vseg(x: number, y1: number, y2: number, style: LineStyle) {
    if (y1 === y2) return
    const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1]
    for (let y = a; y <= b; y++) this.line(x, y, (y > a ? U : 0) | (y < b ? D : 0), style)
  }
  hseg(y: number, x1: number, x2: number, style: LineStyle) {
    if (x1 === x2) return
    const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1]
    for (let x = a; x <= b; x++) this.line(x, y, (x > a ? L_ : 0) | (x < b ? R : 0), style)
  }
  render(): Art {
    const lines: Seg[][] = []
    const plainRows: string[] = []
    let width = 0
    for (const row of this.rows) {
      let last = row.length - 1
      while (last >= 0 && row[last].ch === null && row[last].bits === 0) last--
      const segs: Seg[] = []
      let plain = ''
      let w = 0
      for (let x = 0; x <= last; x++) {
        const c = row[x]
        let ch: string
        let color: string | undefined
        if (c.ch !== null) {
          ch = c.ch
          color = c.color
        } else if (c.bits) {
          ch = lineChar(c.bits, c.style)
          color = c.lineColor
        } else {
          ch = ' '
        }
        if (ch === '') continue
        w += cpWidth(ch.codePointAt(0) ?? 32)
        plain += ch
        const prev = segs[segs.length - 1]
        if (prev && prev.color === color) prev.text += ch
        else segs.push({ text: ch, color })
      }
      width = Math.max(width, w)
      lines.push(segs)
      plainRows.push(plain)
    }
    while (lines.length && plainRows[plainRows.length - 1].trim() === '') {
      lines.pop()
      plainRows.pop()
    }
    return { lines, plain: plainRows.join('\n'), width }
  }
}

function lineChar(bits: number, style: LineStyle): string {
  const v = bits & (U | D)
  const hz = bits & (L_ | R)
  const thick = style === 'thick'
  if (!hz) return style === 'dotted' ? '┊' : thick ? '┃' : '│'
  if (!v) return style === 'dotted' ? '┈' : thick ? '━' : '─'
  const t = thick
  switch (bits) {
    case D | R:
      return t ? '┏' : '╭'
    case D | L_:
      return t ? '┓' : '╮'
    case U | R:
      return t ? '┗' : '╰'
    case U | L_:
      return t ? '┛' : '╯'
    case U | D | R:
      return t ? '┣' : '├'
    case U | D | L_:
      return t ? '┫' : '┤'
    case L_ | R | D:
      return t ? '┳' : '┬'
    case L_ | R | U:
      return t ? '┻' : '┴'
    default:
      return t ? '╋' : '┼'
  }
}

function drawBox(cv: Canvas, n: LNode) {
  const { x, y, w, h, color } = n
  const sets: Record<Shape, string[]> = {
    rect: ['┌', '┐', '└', '┘', '─', '│'],
    round: ['╭', '╮', '╰', '╯', '─', '│'],
    diamond: ['◇', '◇', '◇', '◇', '─', '│'],
    double: ['╔', '╗', '╚', '╝', '═', '║'],
  }
  const [tl, tr, bl, br, hz, vt] = sets[n.shape]
  cv.put(x, y, tl, color)
  cv.put(x + w - 1, y, tr, color)
  cv.put(x, y + h - 1, bl, color)
  cv.put(x + w - 1, y + h - 1, br, color)
  for (let i = 1; i < w - 1; i++) {
    cv.put(x + i, y, hz, color)
    cv.put(x + i, y + h - 1, hz, color)
  }
  for (let j = 1; j < h - 1; j++) {
    cv.put(x, y + j, vt, color)
    cv.put(x + w - 1, y + j, vt, color)
    for (let i = 1; i < w - 1; i++) cv.put(x + i, y + j, ' ')
  }
  n.lines.forEach((ln, j) => {
    const lw = strWidth(ln)
    cv.text(x + Math.floor((w - lw) / 2), y + 1 + j, ln, color)
  })
}

function sizeNodes(layers: LNode[][]) {
  for (const ly of layers)
    for (const n of ly)
      if (n.real) {
        n.w = Math.max(5, Math.max(...n.lines.map(strWidth)) + 4)
        n.h = n.lines.length + 2
      }
}

// ---------------------------------------------------------------- TD

function renderTD(g: Graph, maxLabel: number): Art {
  const { layers, links, chains } = buildLayers(g, maxLabel)
  sizeNodes(layers)
  placeAxis(
    layers,
    links,
    n => n.w,
    (a, b) => (a.real || b.real ? 3 : 1),
    (n, p) => (n.x = p),
    n => n.x,
  )
  straightenDummies(layers, chains, n => n.x, (n, p) => (n.x = p), n => n.w, 3)
  const cx = (n: LNode) => n.x + Math.floor(n.w / 2)

  const bandH = layers.map(ly => Math.max(1, ...ly.filter(n => n.real).map(n => n.h)))
  const labeledInto = layers.map(() => false)
  for (const l of links) if (l.label) labeledInto[l.v.layer] = true
  const gapH = layers.map((_, L) => (L + 1 < layers.length ? (labeledInto[L + 1] ? 4 : 3) : 0))
  const bandTop: number[] = []
  let y = 0
  layers.forEach((_, L) => {
    bandTop[L] = y
    y += bandH[L] + gapH[L]
  })
  for (const ly of layers) for (const n of ly) n.y = bandTop[n.layer]

  const cv = new Canvas()
  // dummies: vertical through the band
  for (const ly of layers)
    for (const n of ly) if (!n.real) cv.vseg(n.x, n.y - 1, n.y + bandH[n.layer], 'solid')

  const marks: [number, number, string, string?][] = []
  for (const l of links) {
    const L = l.u.layer
    const gTop = bandTop[L] + bandH[L]
    const gMid = gTop + 1
    const arrowRow = gTop + gapH[L] - 1
    const sx = cx(l.u)
    const tx = cx(l.v)
    const sy = l.u.real ? l.u.y + l.u.h : gTop - 1
    const st = l.style
    cv.vseg(sx, sy, gMid, st)
    cv.hseg(gMid, sx, tx, st)
    cv.vseg(tx, gMid, l.v.real ? arrowRow : arrowRow + 1, st)
    if (l.u.real && !l.arrowU) marks.push([sx, l.u.y + l.u.h - 1, 'exitD'])
    if (l.arrowV) marks.push([tx, arrowRow, '▼', ARROW_COLOR])
    if (l.arrowU) marks.push([sx, gTop, '▲', ARROW_COLOR])
    if (l.label) {
      const lw = strWidth(l.label)
      marks.push([Math.max(0, tx - Math.floor(lw / 2)), arrowRow - 1, l.label, LABEL_COLOR])
    }
  }
  for (const ly of layers) for (const n of ly) if (n.real) drawBox(cv, n)
  for (const [x, yy, s, color] of marks) {
    if (s === 'exitD') {
      const c = cv.cell(x, yy)
      if (c.ch === '─') c.ch = '┬'
      else if (c.ch === '═') c.ch = '╤'
      continue
    }
    cv.text(x, yy, s, color)
  }
  return cv.render()
}

// ---------------------------------------------------------------- LR

function renderLR(g: Graph, maxLabel: number): Art {
  const { layers, links, chains } = buildLayers(g, maxLabel)
  sizeNodes(layers)
  placeAxis(
    layers,
    links,
    n => n.h,
    (a, b) => (a.real || b.real ? 1 : 0),
    (n, p) => (n.y = p),
    n => n.y,
  )
  straightenDummies(layers, chains, n => n.y, (n, p) => (n.y = p), n => n.h, 1)
  const cy = (n: LNode) => n.y + Math.floor(n.h / 2)

  const colW = layers.map(ly => Math.max(1, ...ly.filter(n => n.real).map(n => n.w)))
  const labelW = layers.map(() => 0)
  for (const l of links)
    if (l.label) {
      const L = l.u.layer
      labelW[L] = Math.max(labelW[L], strWidth(l.label))
    }
  const gapW = layers.map((_, L) => (L + 1 < layers.length ? (labelW[L] ? labelW[L] + 6 : 6) : 0))
  const colX: number[] = []
  let x = 0
  layers.forEach((_, L) => {
    colX[L] = x
    x += colW[L] + gapW[L]
  })
  for (const ly of layers) for (const n of ly) n.x = colX[n.layer]

  const cv = new Canvas()
  for (const ly of layers)
    for (const n of ly) if (!n.real) cv.hseg(n.y, n.x - 1, n.x + colW[n.layer], 'solid')

  const marks: [number, number, string, string?][] = []
  for (const l of links) {
    const L = l.u.layer
    const gLeft = colX[L] + colW[L]
    const gMid = gLeft + 1
    const arrowCol = gLeft + gapW[L] - 1
    const sy = l.u.real ? cy(l.u) : l.u.y
    const ty = l.v.real ? cy(l.v) : l.v.y
    const sx = l.u.real ? l.u.x + l.u.w : gLeft - 1
    const st = l.style
    cv.hseg(sy, sx, gMid, st)
    cv.vseg(gMid, sy, ty, st)
    cv.hseg(ty, gMid, l.v.real ? arrowCol : arrowCol + 1, st)
    if (l.u.real && !l.arrowU) marks.push([l.u.x + l.u.w - 1, sy, 'exitR'])
    if (l.arrowV) marks.push([arrowCol, ty, '►', ARROW_COLOR])
    if (l.arrowU) marks.push([sx, sy, '◄', ARROW_COLOR])
    if (l.label) {
      const lw = strWidth(l.label)
      const span = arrowCol - gMid - 1
      const lx = gMid + 1 + Math.max(0, Math.floor((span - lw) / 2))
      marks.push([lx, ty, l.label, LABEL_COLOR])
    }
  }
  for (const ly of layers) for (const n of ly) if (n.real) drawBox(cv, n)
  for (const [mx, my, s, color] of marks) {
    if (s === 'exitR') {
      const c = cv.cell(mx, my)
      if (c.ch === '│') c.ch = '├'
      else if (c.ch === '║') c.ch = '╟'
      continue
    }
    cv.text(mx, my, s, color)
  }
  return cv.render()
}

// ---------------------------------------------------------------- entry

/** Draws flowchart / graph source; null when it does not parse. */
export function renderFlowchart(src: string, maxWidth: number): Art | null {
  const g = parseFlowchart(src)
  if (!g) return null
  const primary = g.dir === 'LR' ? renderLR(g, 24) : renderTD(g, 24)
  if (primary.width <= maxWidth) return primary
  const alt = g.dir === 'LR' ? renderTD(g, 16) : renderTD(g, 12)
  return alt.width < primary.width ? alt : primary
}
