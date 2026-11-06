// Mermaid gitGraph -> colored lane drawing, oldest commit on top. Pure functions, no I/O.

import type { Art, Seg } from './mermaid'
import { strWidth } from './mermaid'

const PALETTE = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f5c2e7', '#94e2d5', '#fab387', '#cba6f7', '#f38ba8']

type Row =
  | { kind: 'fork'; from: number; to: number }
  | { kind: 'merge'; from: number; to: number }
  | { kind: 'commit'; lane: number; glyph: string; label: string; tag?: string }

type Cell = { ch: string; color?: string }

function opt(st: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(st)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

function glyphFor(type: string | undefined, fallback: string): string {
  const t = (type ?? '').toUpperCase()
  if (t === 'HIGHLIGHT') return '◆'
  if (t === 'REVERSE') return '✕'
  return fallback
}

export function isGitGraph(src: string): boolean {
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/%%.*$/, '').trim()
    if (!line) continue
    return /^gitGraph\b/.test(line)
  }
  return false
}

type Parsed = { rows: Row[]; names: string[] }

function parse(src: string): Parsed | null {
  const main = /mainBranchName['"]?\s*:\s*['"]([^'"]+)['"]/.exec(src)?.[1] ?? 'main'
  const names = [main]
  const lane = new Map<string, number>([[main, 0]])
  const hasCommits = [false]
  const rows: Row[] = []
  let cur = 0
  let started = false

  for (const raw of src.split(/\r?\n/)) {
    const st = raw.replace(/%%.*$/, '').trim()
    if (!st) continue
    if (!started) {
      if (!/^gitGraph\b/.test(st)) return null
      started = true
      continue
    }
    const word = st.split(/\s+/)[0]
    const arg = st.slice(word.length).trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, '')
    if (word === 'commit') {
      rows.push({ kind: 'commit', lane: cur, glyph: glyphFor(opt(st, 'type'), '●'), label: opt(st, 'id') ?? '', tag: opt(st, 'tag') })
      hasCommits[cur] = true
    } else if (word === 'branch') {
      if (!arg || lane.has(arg)) return null
      lane.set(arg, names.length)
      names.push(arg)
      hasCommits.push(false)
      rows.push({ kind: 'fork', from: cur, to: lane.get(arg)! })
      cur = lane.get(arg)!
    } else if (word === 'checkout' || word === 'switch') {
      const l = arg ? lane.get(arg) : undefined
      if (l === undefined) return null
      cur = l
    } else if (word === 'merge') {
      const l = arg ? lane.get(arg) : undefined
      if (l === undefined || l === cur) return null
      rows.push({ kind: 'merge', from: l, to: cur })
      rows.push({ kind: 'commit', lane: cur, glyph: glyphFor(opt(st, 'type'), '◉'), label: opt(st, 'id') ?? `merge ${arg}`, tag: opt(st, 'tag') })
      hasCommits[cur] = true
    } else if (word === 'cherry-pick') {
      rows.push({ kind: 'commit', lane: cur, glyph: '◎', label: `cherry-pick ${opt(st, 'id') ?? ''}`.trim(), tag: opt(st, 'tag') })
      hasCommits[cur] = true
    } else {
      return null
    }
  }
  if (!started) return null
  // a branch that never gets a commit or a merge is not drawn
  const used = new Set<number>([0])
  for (const r of rows) {
    if (r.kind === 'commit') used.add(r.lane)
    if (r.kind === 'merge') used.add(r.from)
  }
  // renumber the drawn lanes so an unused branch leaves no gap
  const map = new Map<number, number>()
  names.forEach((_, l) => {
    if (used.has(l)) map.set(l, map.size)
  })
  const m = (l: number) => map.get(l)!
  const kept: Row[] = []
  for (const r of rows) {
    if (r.kind === 'commit') kept.push({ ...r, lane: m(r.lane) })
    else if (used.has(r.to) && used.has(r.from)) kept.push({ ...r, from: m(r.from), to: m(r.to) })
  }
  return { rows: kept, names: names.filter((_, l) => used.has(l)) }
}

export function renderGitGraph(src: string): Art | null {
  const p = parse(src)
  if (!p || !p.rows.some(r => r.kind === 'commit')) return null
  const { rows, names } = p
  const n = names.length
  const color = (l: number) => PALETTE[l % PALETTE.length]

  // each lane lives from its fork row to the last row that touches it
  const first = new Array<number>(n).fill(-1)
  const last = new Array<number>(n).fill(-1)
  first[0] = 0
  rows.forEach((r, i) => {
    const touch = r.kind === 'commit' ? [r.lane] : [r.from, r.to]
    if (r.kind === 'fork') first[r.to] = i
    for (const l of touch) last[l] = Math.max(last[l], i)
  })
  const alive = (l: number, i: number) => first[l] >= 0 && first[l] <= i && i <= last[l]
  const W = Math.max(1, ...first.map((f, l) => (f >= 0 ? 2 * l + 1 : 0)))

  const seen = new Set<number>()
  const out: Seg[][] = []
  rows.forEach((r, i) => {
    const cells: Cell[] = Array.from({ length: W }, () => ({ ch: ' ' }))
    for (let l = 0; l < n; l++) if (alive(l, i)) cells[2 * l] = { ch: '│', color: color(l) }
    const segs: Seg[] = []

    if (r.kind === 'commit') {
      cells[2 * r.lane] = { ch: r.glyph, color: color(r.lane) }
      if (r.label) segs.push({ text: r.label })
      if (r.tag) segs.push({ text: ` [${r.tag}]`, color: '#f9e2af' })
      if (!seen.has(r.lane)) {
        seen.add(r.lane)
        segs.push({ text: `  ${names[r.lane]}`, color: color(r.lane) })
      }
    } else {
      // horizontal connector between the two lanes, in the color of the side branch
      const side = r.kind === 'fork' ? r.to : r.from
      const a = Math.min(r.from, r.to)
      const b = Math.max(r.from, r.to)
      for (let x = 2 * a + 1; x < 2 * b; x++) {
        const crossing = x % 2 === 0 && alive(x / 2, i)
        cells[x] = { ch: crossing ? '┼' : '─', color: color(side) }
      }
      const leftIsSide = side === a
      const sideEnds = r.kind === 'merge' && last[side] === i
      if (r.kind === 'fork') {
        cells[2 * a] = { ch: leftIsSide ? '╭' : '├', color: color(a) }
        cells[2 * b] = { ch: leftIsSide ? '┤' : '╮', color: color(b) }
      } else {
        // merge: the side lane bends into the target, or tees off if it carries on
        cells[2 * a] = { ch: leftIsSide ? (sideEnds ? '╰' : '├') : '├', color: color(a) }
        cells[2 * b] = { ch: leftIsSide ? '┤' : sideEnds ? '╯' : '┤', color: color(b) }
      }
    }

    const line: Seg[] = []
    for (const c of cells) {
      const prev = line[line.length - 1]
      if (prev && prev.color === c.color) prev.text += c.ch
      else line.push({ text: c.ch, color: c.color })
    }
    if (segs.length) line.push({ text: '  ' }, ...segs)
    out.push(line)
  })

  const plainLines = out.map(l => l.map(s => s.text).join('').replace(/\s+$/, ''))
  return { lines: out, plain: plainLines.join('\n'), width: Math.max(...plainLines.map(strWidth)) }
}
