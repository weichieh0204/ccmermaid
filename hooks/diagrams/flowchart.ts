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
type GNode = { id: string; label: string; shape: Shape; idx: number; cluster: Cluster | null }
type GEdge = { from: string; to: string; label: string; style: LineStyle; head: boolean; tail: boolean }
/** A subgraph: a named frame around some nodes, maybe inside another one. */
type Cluster = { id: string; title: string; parent: Cluster | null }
type Graph = { dir: Dir; nodes: Map<string, GNode>; edges: GEdge[]; clusters: Cluster[]; open: Cluster[] }

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
    n = { id, label: id, shape: 'rect', idx: g.nodes.size, cluster: null }
    g.nodes.set(id, n)
  }
  // as in mermaid: a node first mentioned inside a subgraph belongs to the innermost open one
  if (!n.cluster && g.open.length) n.cluster = g.open[g.open.length - 1]
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

// "A -- text --> B", "A -. text .-> B", "A == text ==> B": the spaces around the text are optional,
// as in mermaid ("A-.text.->B"). The lookahead keeps a plain "-->", "-.->" or "==>" out.
const LABELED = /^(--|==|-\.)(?![->.=])\s*(\S[^|]*?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+)/
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

const SKIP = /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/

/** "subgraph id[Title]", "subgraph id [Title]", "subgraph "Title"" or "subgraph Title words". */
function parseSubgraph(rest: string, index: number): { id: string; title: string } {
  const t = rest.trim()
  const m = /^([\p{L}\p{N}_-]+)\s*\[\s*"?([^"\]]*)"?\s*\]$/u.exec(t)
  if (m) return { id: m[1], title: cleanLabel(m[2]) || m[1] }
  const q = /^"([^"]*)"$/.exec(t)
  if (q) return { id: `__sub${index}`, title: cleanLabel(q[1]) }
  return { id: t || `__sub${index}`, title: cleanLabel(t) }
}

/** An edge label is drawn on one row beside its line, so a <br> inside it becomes " / ". */
function oneLine(label: string): string {
  return label.split('\n').map(t => t.trim()).filter(Boolean).join(' / ')
}

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
        g = { dir: d === 'LR' || d === 'RL' ? 'LR' : 'TD', nodes: new Map(), edges: [], clusters: [], open: [] }
        continue
      }
      const sub = /^subgraph\b(.*)$/.exec(st)
      if (sub) {
        const { id, title } = parseSubgraph(sub[1], g.clusters.length)
        const c: Cluster = { id, title, parent: g.open[g.open.length - 1] ?? null }
        g.clusters.push(c)
        g.open.push(c)
        continue
      }
      if (/^end\b/.test(st)) {
        g.open.pop()
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
            g.edges.push({ from: a, to: b, label: oneLine(ed.label), style: ed.style, head: ed.head, tail: ed.tail })
        left = right
        i = right.end
      }
    }
  }
  if (!g) return null
  const byId = new Map(g.clusters.map(c => [c.id, c]))
  const firstOf = (c: Cluster) => [...g!.nodes.values()].find(n => n.cluster && inside(n.cluster, c) && !byId.has(n.id))
  for (const e of g.edges)
    for (const end of ['from', 'to'] as const) {
      const c = byId.get(e[end])
      const n = c && firstOf(c)
      if (n) e[end] = n.id
    }
  for (const id of byId.keys()) g.nodes.delete(id)
  if (g.nodes.size === 0) return null
  return g
}

/** True when cluster a is c or lies inside it. */
function inside(a: Cluster | null, c: Cluster): boolean {
  for (let x = a; x; x = x.parent) if (x === c) return true
  return false
}

/** The clusters around a node, outermost first. */
function pathOf(c: Cluster | null): Cluster[] {
  const out: Cluster[] = []
  for (let x = c; x; x = x.parent) out.unshift(x)
  return out
}

/** The innermost cluster around both. */
function common(a: Cluster | null, b: Cluster | null): Cluster | null {
  const pa = pathOf(a)
  const pb = pathOf(b)
  let k = 0
  while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++
  return k ? pa[k - 1] : null
}

// ---------------------------------------------------------------- layout

const LINE_COLOR = '#89b4fa'
const ARROW_COLOR = '#cba6f7'
const LABEL_COLOR = 'text'

type LNode = {
  id: string
  cluster: Cluster | null
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

// an edge pointing at an earlier layer, drawn around the graph instead of through it
type BackEdge = { from: LNode; to: LNode; style: LineStyle; label: string; head: boolean; tail: boolean }

type Layout = { layers: LNode[][]; links: Link[]; backs: BackEdge[]; clusters: Cluster[] }

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

  // a reversed edge with a forward twin of the same line style, and no label of its own, stays one
  // double-headed line. The others become back edges, so a dotted or labelled return keeps its look.
  const pair = (a: string, b: string, style: LineStyle) => `${a}\u0000${b}\u0000${style}`
  const forward = new Set(edges.filter((_, k) => !reversed.has(k)).map(e => pair(e.from, e.to, e.style)))
  const isBack = (k: number) =>
    reversed.has(k) && (!!edges[k].label || !forward.has(pair(edges[k].to, edges[k].from, edges[k].style)))

  // longest-path layering
  const dag = edges
    .map((e, k) => (reversed.has(k) ? { u: e.to, v: e.from, k } : { u: e.from, v: e.to, k }))
    .filter(d => !isBack(d.k))
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
      cluster: gn.cluster,
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
        cluster: common(prev.cluster, target.cluster),
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
  if (g.clusters.length) groupClusters(layers)

  const backs = edges.flatMap((e, k) =>
    isBack(k)
      ? [{ from: lnodes.get(e.from)!, to: lnodes.get(e.to)!, style: e.style, label: e.label, head: e.head, tail: e.tail }]
      : [],
  )
  // shortest span first, so longer lanes wrap around shorter ones
  backs.sort((a, b) => a.from.layer - a.to.layer - (b.from.layer - b.to.layer))

  return { layers, links, chains, backs, clusters: g.clusters }
}

/**
 * Reorders every layer so the nodes of one cluster sit next to each other, with no other node
 * between them. A cluster's place is the mean relative position of its nodes over all layers,
 * the same in every layer, so frames do not swap sides from one layer to the next.
 */
function groupClusters(layers: LNode[][]) {
  const rel = (n: LNode) => (layers[n.layer].length > 1 ? n.order / (layers[n.layer].length - 1) : 0.5)
  const sum = new Map<Cluster, [number, number]>()
  for (const ly of layers)
    for (const n of ly)
      for (const c of pathOf(n.cluster)) {
        const [a, k] = sum.get(c) ?? [0, 0]
        sum.set(c, [a + rel(n), k + 1])
      }
  const rank = (c: Cluster) => {
    const [a, k] = sum.get(c)!
    return a / k
  }
  for (const ly of layers) {
    ly.sort((a, b) => {
      const pa = pathOf(a.cluster)
      const pb = pathOf(b.cluster)
      let k = 0
      while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++
      const ka = k < pa.length ? rank(pa[k]) : rel(a)
      const kb = k < pb.length ? rank(pb[k]) : rel(b)
      return ka - kb || a.order - b.order
    })
    ly.forEach((n, i) => (n.order = i))
  }
}

/** How many frame sides stand between two neighbours in a layer. */
function frameSides(a: LNode, b: LNode): number {
  const pa = pathOf(a.cluster)
  const pb = pathOf(b.cluster)
  let k = 0
  while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++
  return pa.length - k + (pb.length - k)
}

type Frame = { c: Cluster; lo: number; hi: number; minL: number; maxL: number }

const FRAME_PAD = 2 // a frame line and one empty cell between it and what it holds

/** Each cluster's span across the layers and, padded, along the cross axis (inner frames first). */
function frames(
  layers: LNode[][],
  clusters: Cluster[],
  pos: (n: LNode) => number,
  size: (n: LNode) => number,
  fitTitle = false,
): Frame[] {
  const byC = new Map<Cluster, Frame>()
  const depth = (c: Cluster) => pathOf(c).length
  for (const c of [...clusters].sort((a, b) => depth(b) - depth(a))) {
    let lo = Infinity
    let hi = -Infinity
    let minL = Infinity
    let maxL = -Infinity
    for (const ly of layers)
      for (const n of ly)
        if (n.cluster === c) {
          lo = Math.min(lo, pos(n))
          hi = Math.max(hi, pos(n) + size(n) - 1)
          minL = Math.min(minL, n.layer)
          maxL = Math.max(maxL, n.layer)
        }
    for (const f of byC.values())
      if (f.c.parent === c) {
        lo = Math.min(lo, f.lo)
        hi = Math.max(hi, f.hi)
        minL = Math.min(minL, f.minL)
        maxL = Math.max(maxL, f.maxL)
      }
    if (lo === Infinity) continue
    lo -= FRAME_PAD
    hi += FRAME_PAD
    // "╭─ title ─╮": the title needs its width plus 5 cells
    if (fitTitle) hi = Math.max(hi, lo + strWidth(c.title) + 5)
    byC.set(c, { c, lo, hi, minL, maxL })
  }
  return [...byC.values()]
}

/**
 * Lays clusters out as blocks: the inside of each cluster is placed first (its nodes and its child
 * clusters, left to right in rank order), which gives the block its width. Then the block is placed
 * like one wide item in its parent, at the same cross position in every layer it spans, so frames
 * never overlap and nothing from outside ends up inside one. Each item is put at the position the
 * plain layout wanted for it, or further on when that would collide with the item before it.
 */
function placeClusters(
  layers: LNode[][],
  clusters: Cluster[],
  pos: (n: LNode) => number,
  set: (n: LNode, p: number) => void,
  size: (n: LNode) => number,
  nodeGap: (a: LNode, b: LNode) => number,
  frameGap: number,
  fitTitle: boolean,
) {
  const all = layers.flat()
  const rel = (n: LNode) => (layers[n.layer].length > 1 ? n.order / (layers[n.layer].length - 1) : 0.5)
  const want = new Map(all.map(n => [n, pos(n)]))
  const kids = new Map<Cluster | null, Cluster[]>()
  const own = new Map<Cluster | null, LNode[]>()
  for (const c of clusters) kids.set(c.parent, [...(kids.get(c.parent) ?? []), c])
  for (const n of all) own.set(n.cluster, [...(own.get(n.cluster) ?? []), n])
  const under = (c: Cluster) => all.filter(n => inside(n.cluster, c))
  const rank = (c: Cluster) => {
    const ns = under(c)
    return ns.reduce((t, n) => t + rel(n), 0) / Math.max(1, ns.length)
  }

  type Block = { off: Map<LNode, number>; width: number; minL: number; maxL: number; centre: number }
  type Item = { node?: LNode; block?: Block; minL: number; maxL: number; w: number; rank: number; want: number }

  const build = (c: Cluster | null): Block | null => {
    const items: Item[] = []
    for (const k of kids.get(c) ?? []) {
      const b = build(k)
      if (b) items.push({ block: b, minL: b.minL, maxL: b.maxL, w: b.width, rank: rank(k), want: b.centre - b.width / 2 })
    }
    for (const n of own.get(c) ?? [])
      items.push({ node: n, minL: n.layer, maxL: n.layer, w: size(n), rank: rel(n), want: want.get(n)! })
    if (!items.length) return null
    items.sort((a, b) => a.rank - b.rank || a.want - b.want)
    const right = new Map<number, { end: number; item: Item }>()
    const at = new Map<Item, number>()
    for (const it of items) {
      let min = -Infinity
      for (let L = it.minL; L <= it.maxL; L++) {
        const prev = right.get(L)
        if (!prev) continue
        const gap = it.node && prev.item.node ? nodeGap(prev.item.node, it.node) : frameGap
        min = Math.max(min, prev.end + gap)
      }
      const x = Math.max(min, Math.round(it.want))
      at.set(it, x)
      for (let L = it.minL; L <= it.maxL; L++) right.set(L, { end: x + it.w, item: it })
    }
    const lo = Math.min(...[...at.values()])
    const hi = Math.max(...items.map(it => at.get(it)! + it.w))
    const pad = c ? FRAME_PAD : 0
    const off = new Map<LNode, number>()
    for (const it of items) {
      const x = at.get(it)! - lo + pad
      if (it.node) off.set(it.node, x)
      else for (const [n, o] of it.block!.off) off.set(n, x + o)
    }
    let width = hi - lo + 2 * pad
    if (c && fitTitle) width = Math.max(width, strWidth(c.title) + 5)
    const centre = lo + (hi - lo) / 2
    return {
      off,
      width,
      minL: Math.min(...items.map(it => it.minL)),
      maxL: Math.max(...items.map(it => it.maxL)),
      centre,
    }
  }
  const root = build(null)
  if (!root) return
  for (const [n, x] of root.off) set(n, x)
}

/** Nesting numbers for the frame lines that share a gap: outer frames start first, inner ones end first. */
function frameRows(fs: Frame[]) {
  const startIdx = new Map<Cluster, number>()
  const endIdx = new Map<Cluster, number>()
  for (const f of fs) {
    let k = 0
    for (let p = f.c.parent; p; p = p.parent) if (fs.find(o => o.c === p)?.minL === f.minL) k++
    startIdx.set(f.c, k)
  }
  const endDepth = (f: Frame): number =>
    Math.max(0, ...fs.filter(o => o.c.parent === f.c && o.maxL === f.maxL).map(o => endDepth(o) + 1))
  for (const f of fs) endIdx.set(f.c, endDepth(f))
  const starts = (L: number) => Math.max(0, ...fs.filter(f => f.minL === L).map(f => startIdx.get(f.c)! + 1))
  const ends = (L: number) => Math.max(0, ...fs.filter(f => f.maxL === L).map(f => endIdx.get(f.c)! + 1))
  return { startIdx, endIdx, starts, ends }
}

const FRAME_COLOR = '#6c7086'
const FRAME_TITLE = '#a6adc8'

/** Draws a frame as lines (so a crossing edge makes a junction) and writes its title on the top side. */
function drawFrame(cv: Canvas, left: number, top: number, right: number, bottom: number, title: string, marks: [number, number, string, string?][]) {
  cv.hseg(top, left, right, 'solid', FRAME_COLOR)
  cv.hseg(bottom, left, right, 'solid', FRAME_COLOR)
  cv.vseg(left, top, bottom, 'solid', FRAME_COLOR)
  cv.vseg(right, top, bottom, 'solid', FRAME_COLOR)
  const room = right - left - 4
  if (room < 1 || !title) return
  let t = title
  while (strWidth(t) > room && t.length > 1) t = t.slice(0, -1)
  if (t !== title) t = t.slice(0, -1) + '…'
  marks.unshift([left + 2, top, ` ${t} `, FRAME_TITLE])
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
  line(x: number, y: number, bits: number, style: LineStyle, color = LINE_COLOR) {
    if (x < 0 || y < 0) return
    const c = this.cell(x, y)
    c.bits |= bits
    if (style !== 'solid') c.style = style
    c.lineColor = color
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
  vseg(x: number, y1: number, y2: number, style: LineStyle, color?: string) {
    if (y1 === y2) return
    const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1]
    for (let y = a; y <= b; y++) this.line(x, y, (y > a ? U : 0) | (y < b ? D : 0), style, color)
  }
  hseg(y: number, x1: number, x2: number, style: LineStyle, color?: string) {
    if (x1 === x2) return
    const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1]
    for (let x = a; x <= b; x++) this.line(x, y, (x > a ? L_ : 0) | (x < b ? R : 0), style, color)
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
  const { layers, links, chains, backs, clusters } = buildLayers(g, maxLabel)
  sizeNodes(layers)
  // a label sits to the right of its line, so a wide one needs room past its box
  const labelRoom = new Map<LNode, number>()
  for (const l of links)
    if (l.label) {
      const past = 2 + strWidth(l.label) - (l.v.w - Math.floor(l.v.w / 2))
      labelRoom.set(l.v, Math.max(labelRoom.get(l.v) ?? 0, past))
    }
  placeAxis(
    layers,
    links,
    n => n.w,
    (a, b) => (a.real || b.real ? 3 : 1) + (labelRoom.get(a) ?? 0) + FRAME_PAD * frameSides(a, b),
    (n, p) => (n.x = p),
    n => n.x,
  )
  straightenDummies(layers, chains, n => n.x, (n, p) => (n.x = p), n => n.w, 3)
  if (clusters.length)
    placeClusters(layers, clusters, n => n.x, (n, p) => (n.x = p), n => n.w,
      (a, b) => (a.real || b.real ? 3 : 1) + (labelRoom.get(a) ?? 0), 2, true)
  const cx = (n: LNode) => n.x + Math.floor(n.w / 2)
  const fs = frames(layers, clusters, n => n.x, n => n.w, true)
  const fr = frameRows(fs)

  // rows in the gap under layer L: the exit row(s), where frames ending at L close (inner first),
  // the row the edges turn on, the top sides of frames starting at L + 1 (outer first),
  // a label row when an edge into L + 1 has one, and the arrow row
  const bandH = layers.map(ly => Math.max(1, ...ly.filter(n => n.real).map(n => n.h)))
  const labeledInto = layers.map(() => false)
  for (const l of links) if (l.label) labeledInto[l.v.layer] = true
  const exitRows = layers.map((_, L) => (fr.ends(L) ? fr.ends(L) + 1 : 1))
  const gapH = layers.map((_, L) =>
    L + 1 < layers.length ? exitRows[L] + 1 + fr.starts(L + 1) + (labeledInto[L + 1] ? 1 : 0) + 1 : 0,
  )
  const bandTop: number[] = []
  let y = fr.starts(0) ? fr.starts(0) + 1 : 0
  layers.forEach((_, L) => {
    bandTop[L] = y
    y += bandH[L] + gapH[L]
  })
  for (const ly of layers) for (const n of ly) n.y = bandTop[n.layer]

  const cv = new Canvas()
  const marks: [number, number, string, string?][] = []
  for (const f of fs) {
    const top =
      f.minL === 0
        ? fr.startIdx.get(f.c)!
        : bandTop[f.minL - 1] + bandH[f.minL - 1] + exitRows[f.minL - 1] + 1 + fr.startIdx.get(f.c)!
    const bottom = bandTop[f.maxL] + bandH[f.maxL] + 1 + fr.endIdx.get(f.c)!
    drawFrame(cv, f.lo, top, f.hi, bottom, f.c.title, marks)
  }
  // dummies: vertical through the band
  for (const ly of layers)
    for (const n of ly) if (!n.real) cv.vseg(n.x, n.y - 1, n.y + bandH[n.layer], 'solid')

  for (const l of links) {
    const L = l.u.layer
    const gTop = bandTop[L] + bandH[L]
    const gMid = gTop + exitRows[L]
    const arrowRow = gTop + gapH[L] - 1
    const sx = cx(l.u)
    const tx = cx(l.v)
    const sy = l.u.real ? l.u.y + l.u.h - 1 : gTop - 1
    const st = l.style
    cv.vseg(sx, sy, gMid, st)
    cv.hseg(gMid, sx, tx, st)
    cv.vseg(tx, gMid, l.v.real ? arrowRow : arrowRow + 1, st)
    if (l.u.real && !l.arrowU) marks.push([sx, l.u.y + l.u.h - 1, 'exitD'])
    if (l.arrowV) marks.push([tx, arrowRow, '▼', ARROW_COLOR])
    if (l.arrowU) marks.push([sx, gTop, '▲', ARROW_COLOR])
    // beside the line: a double-width character cannot be centred on a one-cell line
    if (l.label) marks.push([tx + 2, arrowRow - 1, l.label, LABEL_COLOR])
  }

  // back edges: out of the right side, up a lane right of the graph, into the right side
  const labelEnd = links.filter(l => l.label).map(l => cx(l.v) + 2 + strWidth(l.label))
  let laneX = Math.max(...layers.flat().map(n => n.x + n.w), ...labelEnd, ...fs.map(f => f.hi + 1)) + 1
  for (const b of backs) {
    const lane = laneX
    const port = (n: LNode): number => {
      const py = n.y + Math.floor(n.h / 2)
      const edge = n.x + n.w - 1
      if (!layers[n.layer].some(o => o.real && o.x > n.x)) {
        cv.hseg(py, edge, lane, b.style)
        return py
      }
      // a box on the right: step down to the free row under this band and run along it
      const c = edge + 2
      const row = bandTop[n.layer] + bandH[n.layer]
      cv.hseg(py, edge, c, b.style)
      cv.vseg(c, py, row, b.style)
      cv.hseg(row, c, lane, b.style)
      return row
    }
    const ys = port(b.from)
    const ye = port(b.to)
    cv.vseg(lane, ys, ye, b.style)
    const sy = b.from.y + Math.floor(b.from.h / 2)
    const ty = b.to.y + Math.floor(b.to.h / 2)
    if (!b.tail) marks.push([b.from.x + b.from.w - 1, sy, 'exitR'])
    else marks.push([b.from.x + b.from.w, sy, '◄', ARROW_COLOR])
    if (b.head) marks.push([b.to.x + b.to.w, ty, '◄', ARROW_COLOR])
    if (b.label) marks.push([lane + 2, Math.floor((ys + ye) / 2), b.label, LABEL_COLOR])
    laneX += 2 + (b.label ? strWidth(b.label) + 2 : 0)
  }
  for (const ly of layers) for (const n of ly) if (n.real) drawBox(cv, n)
  for (const [x, yy, s, color] of marks) {
    if (s === 'exitD') {
      const c = cv.cell(x, yy)
      if (c.ch === '─') c.ch = '┬'
      else if (c.ch === '═') c.ch = '╤'
      continue
    }
    if (s === 'exitR') {
      const c = cv.cell(x, yy)
      if (c.ch === '│') c.ch = '├'
      else if (c.ch === '║') c.ch = '╟'
      continue
    }
    cv.text(x, yy, s, color)
  }
  return cv.render()
}

// ---------------------------------------------------------------- LR

function renderLR(g: Graph, maxLabel: number): Art {
  const { layers, links, chains, backs, clusters } = buildLayers(g, maxLabel)
  sizeNodes(layers)
  placeAxis(
    layers,
    links,
    n => n.h,
    (a, b) => (a.real || b.real ? 1 : 0) + FRAME_PAD * frameSides(a, b),
    (n, p) => (n.y = p),
    n => n.y,
  )
  straightenDummies(layers, chains, n => n.y, (n, p) => (n.y = p), n => n.h, 1)
  if (clusters.length)
    placeClusters(layers, clusters, n => n.y, (n, p) => (n.y = p), n => n.h, (a, b) => (a.real || b.real ? 1 : 0), 1, false)
  const cy = (n: LNode) => n.y + Math.floor(n.h / 2)
  const fs = frames(layers, clusters, n => n.y, n => n.h)
  const fr = frameRows(fs)

  const colW = layers.map(ly => Math.max(1, ...ly.filter(n => n.real).map(n => n.w)))
  const labelW = layers.map(() => 0)
  for (const l of links)
    if (l.label) {
      const L = l.u.layer
      labelW[L] = Math.max(labelW[L], strWidth(l.label))
    }
  const boxBelow = (n: LNode) => layers[n.layer].some(o => o.real && o.y > n.y)
  // layers where a back edge has to step around a box get a free column for it
  const channel = layers.map((_, L) => (backs.some(b => [b.from, b.to].some(n => n.layer === L && boxBelow(n))) ? 2 : 0))
  // columns in the gap right of layer L: the exit column(s), where frames ending at L close
  // (inner first), the back-edge channel, the column the edges turn on, the label span,
  // the left sides of frames starting at L + 1 (outer first), and the arrow column
  // nested right sides stand two columns apart, and a frame is made wide enough for its title
  // by widening the gap after its last layer
  const extra = new Map<Cluster, number>()
  const rightOff = (f: Frame) => 1 + 2 * fr.endIdx.get(f.c)! + (extra.get(f.c) ?? 0)
  const exitCols = layers.map(() => 1)
  const colX: number[] = []
  const gapW: number[] = []
  const placeCols = () => {
    layers.forEach((_, L) => {
      exitCols[L] = Math.max(1, ...fs.filter(f => f.maxL === L).map(f => rightOff(f) + 1))
      gapW[L] =
        L + 1 < layers.length
          ? exitCols[L] + channel[L] + 1 + (labelW[L] ? labelW[L] + 4 : 4) + fr.starts(L + 1)
          : channel[L]
    })
    let x = fr.starts(0) ? fr.starts(0) + 1 : 0
    layers.forEach((_, L) => {
      colX[L] = x
      x += colW[L] + gapW[L]
    })
  }
  const leftOf = (f: Frame) =>
    f.minL === 0 ? fr.startIdx.get(f.c)! : colX[f.minL] - 1 - fr.starts(f.minL) + fr.startIdx.get(f.c)!
  const rightOf = (f: Frame) => colX[f.maxL] + colW[f.maxL] + rightOff(f)
  placeCols()
  // inner frames first, so an outer frame ending on the same layer is checked after its children grew
  for (const f of [...fs].sort((a, b) => fr.endIdx.get(a.c)! - fr.endIdx.get(b.c)!)) {
    const short = strWidth(f.c.title) + 5 - (rightOf(f) - leftOf(f) + 1)
    if (short > 0) extra.set(f.c, short)
    for (const o of fs)
      if (o.maxL === f.maxL && o !== f && inside(f.c, o.c))
        extra.set(o.c, Math.max(extra.get(o.c) ?? 0, rightOff(f) + 2 - (1 + 2 * fr.endIdx.get(o.c)!)))
    placeCols()
  }
  for (const ly of layers) for (const n of ly) n.x = colX[n.layer]

  const cv = new Canvas()
  const marks: [number, number, string, string?][] = []
  for (const f of fs) drawFrame(cv, leftOf(f), f.lo, rightOf(f), f.hi, f.c.title, marks)
  for (const ly of layers)
    for (const n of ly) if (!n.real) cv.hseg(n.y, n.x - 1, n.x + colW[n.layer], 'solid')

  for (const l of links) {
    const L = l.u.layer
    const gLeft = colX[L] + colW[L]
    const gMid = gLeft + exitCols[L] + channel[L]
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
      const span = arrowCol - fr.starts(L + 1) - gMid - 1
      const lx = gMid + 1 + Math.max(0, Math.floor((span - lw) / 2))
      marks.push([lx, ty, l.label, LABEL_COLOR])
    }
  }

  // back edges: out of the bottom, left along a lane under the graph, up into the bottom
  const laneTop = Math.max(...layers.flat().map(n => n.y + n.h), ...fs.map(f => f.hi + 1)) + 1
  backs.forEach((b, i) => {
    const laneY = laneTop + i
    const port = (n: LNode): number => {
      const px = n.x + Math.floor(n.w / 2)
      const edge = n.y + n.h - 1
      if (!boxBelow(n)) {
        cv.vseg(px, edge, laneY, b.style)
        return px
      }
      // a box underneath: run along the free row below this box to the column gap, then down
      const c = colX[n.layer] + colW[n.layer] + 1
      const row = n.y + n.h
      cv.vseg(px, edge, row, b.style)
      cv.hseg(row, px, c, b.style)
      cv.vseg(c, row, laneY, b.style)
      return c
    }
    const xs = port(b.from)
    const xe = port(b.to)
    cv.hseg(laneY, xs, xe, b.style)
    const sx = b.from.x + Math.floor(b.from.w / 2)
    const tx = b.to.x + Math.floor(b.to.w / 2)
    if (!b.tail) marks.push([sx, b.from.y + b.from.h - 1, 'exitB'])
    else marks.push([sx, b.from.y + b.from.h, '▲', ARROW_COLOR])
    if (b.head) marks.push([tx, b.to.y + b.to.h, '▲', ARROW_COLOR])
    if (b.label) {
      const lw = strWidth(b.label)
      const [a, z] = xs < xe ? [xs, xe] : [xe, xs]
      marks.push([Math.max(a + 1, Math.floor((a + z - lw) / 2)), laneY, b.label, LABEL_COLOR])
    }
  })
  for (const ly of layers) for (const n of ly) if (n.real) drawBox(cv, n)
  for (const [mx, my, s, color] of marks) {
    if (s === 'exitR') {
      const c = cv.cell(mx, my)
      if (c.ch === '│') c.ch = '├'
      else if (c.ch === '║') c.ch = '╟'
      continue
    }
    if (s === 'exitB') {
      const c = cv.cell(mx, my)
      if (c.ch === '─') c.ch = '┬'
      else if (c.ch === '═') c.ch = '╤'
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
