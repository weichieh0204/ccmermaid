// Mermaid sequenceDiagram, gantt, pie, mindmap, timeline -> colored text art,
// and stateDiagram -> flowchart source. Pure functions, no I/O.

import type { Art, Seg } from './mermaid'
import { strWidth } from './mermaid'

const PALETTE = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f5c2e7', '#94e2d5', '#fab387', '#cba6f7', '#f38ba8']
const DIM = '#6c7086'
const LINE = '#89b4fa'
const ARROW = '#cba6f7'
const TITLE = '#f9e2af'

// ---------------------------------------------------------------- helpers

/** Source lines with comments and init directives removed, blank lines dropped. */
function srcLines(src: string): string[] {
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

function clean(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/#quot;|&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function unquote(s: string): string {
  const t = s.trim()
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - strWidth(s)))
}

function cut(s: string, w: number): string {
  if (strWidth(s) <= w) return s
  let out = ''
  for (const ch of s) {
    if (strWidth(out + ch) > w - 1) break
    out += ch
  }
  return out + '…'
}

function toArt(lines: Seg[][]): Art {
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
class Canvas {
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

// ---------------------------------------------------------------- state -> flowchart

/** Rewrites a stateDiagram as flowchart source, so the flowchart renderer draws it. */
export function stateToFlowchart(src: string): string | null {
  const lines = srcLines(src)
  if (!/^stateDiagram(-v2)?\b/.test(lines[0]?.trim() ?? '')) return null
  let dir = 'TD'
  const out: string[] = []
  const labels = new Map<string, string>()
  const shapes = new Map<string, string>()
  let inNote = false
  let starts = 0
  let ends = 0
  const id = (raw: string, side: 'from' | 'to') => {
    const t = raw.trim()
    if (t === '[*]') {
      if (side === 'from') {
        starts++
        return '__start'
      }
      ends++
      return '__end'
    }
    return t.replace(/[^\p{L}\p{N}_]/gu, '_')
  }
  for (const raw of lines.slice(1)) {
    const st = raw.trim()
    if (inNote) {
      if (/^end\s+note\b/.test(st)) inNote = false
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^direction\s+(LR|RL|TB|TD|BT)\b/.exec(st))) {
      dir = m[1] === 'LR' || m[1] === 'RL' ? 'LR' : 'TD'
      continue
    }
    if (/^note\b/.test(st)) {
      if (!st.includes(':')) inNote = true
      continue
    }
    if (/^(classDef|class|style|accTitle|accDescr|\{|\}|--)/.test(st) || st === '}') continue
    if ((m = /^state\s+"([^"]+)"\s+as\s+([\p{L}\p{N}_]+)/u.exec(st))) {
      labels.set(m[2], clean(m[1]))
      continue
    }
    if ((m = /^state\s+([\p{L}\p{N}_]+)\s*<<(choice|fork|join)>>/u.exec(st))) {
      shapes.set(m[1], m[2])
      continue
    }
    if (/^state\s+/.test(st)) continue
    if ((m = /^(\[\*\]|[\p{L}\p{N}_]+)\s*-->\s*(\[\*\]|[\p{L}\p{N}_]+)\s*(?::\s*(.*))?$/u.exec(st))) {
      const a = id(m[1], 'from')
      const b = id(m[2], 'to')
      const lab = m[3] ? clean(m[3]).replace(/\|/g, '/') : ''
      out.push(lab ? `${a} -->|${lab}| ${b}` : `${a} --> ${b}`)
      continue
    }
    if ((m = /^([\p{L}\p{N}_]+)\s*:\s*(.+)$/u.exec(st))) {
      labels.set(m[1], clean(m[2]))
      continue
    }
  }
  if (!out.length) return null
  const decl: string[] = []
  if (starts) decl.push('__start((●))')
  if (ends) decl.push('__end((◉))')
  for (const [k, v] of labels) decl.push(`${k}(${v.replace(/[()[\]{}]/g, ' ')})`)
  for (const [k, v] of shapes) decl.push(v === 'choice' ? `${k}{${labels.get(k) ?? '?'}}` : `${k}[${v}]`)
  return [`flowchart ${dir}`, ...decl, ...out].join('\n')
}

// ---------------------------------------------------------------- sequence

type SeqEv =
  | { kind: 'msg'; a: number; b: number; text: string; dotted: boolean; head: string }
  | { kind: 'note'; a: number; b: number; text: string }
  | { kind: 'block'; text: string }

function renderSequence(src: string, maxWidth: number): Art | null {
  const lines = srcLines(src)
  const ids: string[] = []
  const names: string[] = []
  const idx = (id: string, label?: string) => {
    let i = ids.indexOf(id)
    if (i < 0) {
      ids.push(id)
      names.push(label ?? id)
      i = ids.length - 1
    } else if (label) names[i] = label
    return i
  }
  const evs: SeqEv[] = []
  let title = ''
  let autonumber = false
  let n = 0
  const ARROW_RE = /^([^\s:+\-<>]+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*([^\s:+\-<>]+?)\s*:\s*(.*)$/u
  for (const raw of lines.slice(1)) {
    const st = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/.exec(st))) {
      idx(m[2], m[3] ? clean(m[3]) : undefined)
      continue
    }
    if ((m = /^title\s*:?\s*(.+)$/.exec(st))) {
      title = clean(m[1])
      continue
    }
    if (/^autonumber\b/.test(st)) {
      autonumber = true
      continue
    }
    if (/^(activate|deactivate|box|create|destroy|link|links|properties|details)\b/.test(st)) continue
    if ((m = /^(loop|alt|else|opt|par|and|critical|option|break|rect)\b\s*(.*)$/.exec(st))) {
      evs.push({ kind: 'block', text: `${m[1]} ${m[1] === 'rect' ? '' : clean(m[2])}`.trim() })
      continue
    }
    if (st === 'end') {
      evs.push({ kind: 'block', text: 'end' })
      continue
    }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(st))) {
      const who = m[2].split(',').map(s => idx(s.trim()))
      evs.push({ kind: 'note', a: Math.min(...who), b: Math.max(...who), text: clean(m[3]) })
      continue
    }
    if ((m = ARROW_RE.exec(st))) {
      const a = idx(m[1])
      const b = idx(m[3])
      const t = m[2]
      const head = t.endsWith('x') ? '✕' : t.endsWith(')') ? '›' : t.endsWith('>>') ? '▶' : '›'
      n++
      evs.push({ kind: 'msg', a, b, text: (autonumber ? `${n}. ` : '') + clean(m[4]), dotted: t.includes('--'), head })
      continue
    }
  }
  if (!ids.length) return null

  // spacing between neighbouring lifelines: fits the widest name and each message label
  const nameW = Math.max(...names.map(strWidth))
  let gap = Math.max(nameW + 4, 14)
  for (const e of evs) {
    if (e.kind === 'msg' && e.a !== e.b) gap = Math.max(gap, Math.ceil((strWidth(e.text) + 4) / Math.abs(e.a - e.b)))
  }
  const left = Math.ceil(nameW / 2) + 2
  const maxGap = ids.length > 1 ? Math.floor((maxWidth - left * 2) / (ids.length - 1)) : gap
  gap = Math.max(8, Math.min(gap, maxGap))
  const xs = ids.map((_, i) => left + i * gap)
  const W = xs[xs.length - 1] + left + 20
  const cv = new Canvas(W)
  let y = 0
  if (title) cv.put(0, y++, title, TITLE)

  const box = (yy: number, top: boolean) => {
    names.forEach((nm, i) => {
      const label = cut(nm, gap - 3)
      const w = strWidth(label) + 2
      const x0 = xs[i] - Math.floor(w / 2) - 1
      const c = PALETTE[i % PALETTE.length]
      cv.put(x0, yy, '┌' + '─'.repeat(w) + '┐', c)
      cv.put(x0, yy + 1, '│ ' + label + ' │', c)
      const bottom = '└' + '─'.repeat(w) + '┘'
      cv.put(x0, yy + 2, bottom, c)
      cv.put(xs[i], top ? yy + 2 : yy, top ? '┬' : '┴', c)
    })
  }
  box(y, true)
  y += 3
  const lifelines = (yy: number) => xs.forEach(x => cv.put(x, yy, '│', DIM))
  let depth = 0
  for (const e of evs) {
    if (e.kind === 'block') {
      lifelines(y)
      if (e.text === 'end') depth = Math.max(0, depth - 1)
      const label = `┈┈ ${e.text} ┈┈`
      cv.put(Math.max(0, xs[0] - 1 + depth * 2), y++, label, DIM)
      if (/^(loop|alt|opt|par|critical|break|rect)\b/.test(e.text)) depth++
      continue
    }
    if (e.kind === 'note') {
      lifelines(y)
      const text = `[ ${e.text} ]`
      const mid = Math.round((xs[e.a] + xs[e.b]) / 2)
      cv.put(Math.max(0, mid - Math.floor(strWidth(text) / 2)), y++, text, TITLE)
      continue
    }
    const c = PALETTE[e.a % PALETTE.length]
    if (e.a === e.b) {
      const x = xs[e.a]
      lifelines(y)
      cv.put(x, y, '├─╮ ', ARROW)
      cv.put(x + 4, y++, e.text, c)
      lifelines(y)
      cv.put(x, y++, '◀─╯', ARROW)
      continue
    }
    const lo = Math.min(xs[e.a], xs[e.b])
    const hi = Math.max(xs[e.a], xs[e.b])
    lifelines(y)
    cv.put(lo + 2, y++, cut(e.text, Math.max(6, hi - lo - 2)), c)
    lifelines(y)
    const body = (e.dotted ? '┄' : '─').repeat(hi - lo - 1)
    const right = xs[e.b] > xs[e.a]
    const head = right ? e.head : e.head === '▶' ? '◀' : e.head === '›' ? '‹' : e.head
    cv.put(lo + 1, y, body, ARROW)
    cv.put(right ? hi - 1 : lo + 1, y, head, ARROW)
    y++
  }
  lifelines(y++)
  box(y, false)
  return cv.art()
}

// ---------------------------------------------------------------- gantt

const UNIT: Record<string, number> = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, M: 2592e6, y: 31536e6 }

function renderGantt(src: string, maxWidth: number): Art | null {
  const lines = srcLines(src)
  let title = ''
  let fmt = 'YYYY-MM-DD'
  type Task = { section: string; name: string; id?: string; start: number; end: number; tags: Set<string> }
  const tasks: Task[] = []
  const byId = new Map<string, Task>()
  let section = ''
  const numeric = () => /^[xX]$/.test(fmt.trim())
  const numFactor = () => (fmt.trim() === 'X' ? 1e3 : 1)

  const parseDate = (s: string): number | null => {
    const t = s.trim()
    if (numeric()) return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) * numFactor() : null
    let m: RegExpExecArray | null
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t))) return (+m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0)) * 1e3
    if (!/^\d{4}-\d{1,2}-\d{1,2}/.test(t) && !/^\d/.test(t)) return null
    const v = Date.parse(t.replace(' ', 'T') + (t.length <= 10 ? 'T00:00:00Z' : 'Z'))
    return Number.isNaN(v) ? null : v
  }
  const parseDur = (s: string): number | null => {
    const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|M|y)$/.exec(s.trim())
    if (m) return Number(m[1]) * UNIT[m[2]]
    if (numeric() && /^\d+(\.\d+)?$/.test(s.trim())) return Number(s) * numFactor()
    return null
  }
  const parseStart = (s: string): number | null => {
    const m = /^after\s+(.+)$/.exec(s.trim())
    if (m) {
      const ends = m[1].split(/\s+/).map(i => byId.get(i)?.end).filter((v): v is number => v !== undefined)
      return ends.length ? Math.max(...ends) : null
    }
    return parseDate(s)
  }
  const parseEnd = (s: string, start: number): number | null => {
    const m = /^until\s+(.+)$/.exec(s.trim())
    if (m) return byId.get(m[1].trim())?.start ?? null
    const v = parseDate(s)
    if (v !== null) return v
    const d = parseDur(s)
    return d === null ? null : start + d
  }
  const TAGS = new Set(['done', 'active', 'crit', 'milestone'])

  for (const raw of lines.slice(1)) {
    const st = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(st))) title = clean(m[1])
    else if ((m = /^dateFormat\s+(.+)$/.exec(st))) fmt = m[1].trim()
    else if ((m = /^section\s+(.+)$/.exec(st))) section = clean(m[1])
    else if (/^(axisFormat|tickInterval|excludes|includes|todayMarker|weekday|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr)\b/.test(st)) continue
    else if ((m = /^([^:]+?)\s*:\s*(.+)$/.exec(st))) {
      const parts = m[2].split(',').map(p => p.trim()).filter(Boolean)
      const tags = new Set<string>()
      while (parts.length && TAGS.has(parts[0])) tags.add(parts.shift()!)
      const prevEnd = tasks.length ? tasks[tasks.length - 1].end : 0
      let tid: string | undefined
      let start: number | null = null
      let end: number | null = null
      if (parts.length >= 3) {
        tid = parts[0]
        start = parseStart(parts[1])
        if (start !== null) end = parseEnd(parts[2], start)
      } else if (parts.length === 2) {
        const s0 = parseStart(parts[0])
        if (s0 !== null) {
          start = s0
          end = parseEnd(parts[1], s0)
        } else {
          tid = parts[0]
          start = prevEnd
          end = parseEnd(parts[1], prevEnd)
        }
      } else if (parts.length === 1) {
        start = prevEnd
        end = parseEnd(parts[0], prevEnd)
      }
      if (start === null) continue
      if (end === null) end = start
      const t: Task = { section, name: clean(m[1]), id: tid, start, end, tags }
      tasks.push(t)
      if (tid) byId.set(tid, t)
    }
  }
  if (!tasks.length) return null

  const t0 = Math.min(...tasks.map(t => t.start))
  const t1 = Math.max(...tasks.map(t => t.end))
  const span = Math.max(1, t1 - t0)
  const labelW = Math.min(24, Math.max(...tasks.map(t => strWidth(t.name) + 2), ...tasks.map(t => strWidth(t.section))))
  const barW = Math.max(10, Math.min(60, maxWidth - labelW - 3))
  const col = (v: number) => Math.round(((v - t0) / span) * barW)

  const fmtTime = (v: number) => {
    if (numeric()) return String(+(v / numFactor()).toFixed(2))
    const d = new Date(v)
    const iso = d.toISOString()
    if (span < 864e5 && v < 864e5 * 2) return iso.slice(11, 16)
    if (span < 864e5) return iso.slice(5, 16).replace('T', ' ')
    return iso.slice(0, 10)
  }

  const out: Seg[][] = []
  if (title) out.push([{ text: title, color: TITLE }])
  let lastSection: string | null = null
  const sections: string[] = []
  for (const t of tasks) {
    if (t.section !== lastSection) {
      lastSection = t.section
      if (!sections.includes(t.section)) sections.push(t.section)
      if (t.section) out.push([{ text: cut(t.section, labelW), color: PALETTE[sections.indexOf(t.section) % PALETTE.length] }])
    }
    const c = t.tags.has('crit') ? '#f38ba8' : t.tags.has('done') ? DIM : PALETTE[sections.indexOf(t.section) % PALETTE.length]
    const a = col(t.start)
    const b = Math.max(a + 1, col(t.end))
    const bar = t.tags.has('milestone') ? '◆' : (t.tags.has('active') ? '▓' : '█').repeat(b - a)
    out.push([
      { text: pad('  ' + cut(t.name, labelW - 2), labelW) + ' │' },
      { text: ' '.repeat(a) },
      { text: bar, color: c },
    ])
  }
  const startLabel = fmtTime(t0)
  const endLabel = fmtTime(t1)
  out.push([{ text: ' '.repeat(labelW) + ' └' + '─'.repeat(barW), color: DIM }])
  out.push([
    { text: ' '.repeat(labelW + 2) + pad(startLabel, Math.max(strWidth(startLabel) + 1, barW - strWidth(endLabel))) + endLabel, color: DIM },
  ])
  return toArt(out)
}

// ---------------------------------------------------------------- pie

function renderPie(src: string, maxWidth: number): Art | null {
  const lines = srcLines(src)
  let title = /^pie\b(?:\s+showData)?(?:\s+title\s+(.+))?/.exec(lines[0].trim())?.[1] ?? ''
  const items: { label: string; value: number }[] = []
  for (const raw of lines.slice(1)) {
    const st = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(st))) title = m[1]
    else if ((m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(st))) items.push({ label: clean(unquote(m[1])), value: Number(m[2]) })
  }
  if (!items.length) return null
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1
  const color = (k: number) => PALETTE[k % PALETTE.length]
  const labelW = Math.min(24, Math.max(...items.map(i => strWidth(i.label))))
  const barW = Math.max(20, Math.min(60, maxWidth - 2))

  // one bar for the whole, each slice a colored run, rounded so the runs fill the bar exactly
  const bar: Seg[] = []
  let acc = 0
  let drawn = 0
  items.forEach((it, k) => {
    acc += Math.max(0, it.value)
    const upto = Math.round((acc / total) * barW)
    const len = Math.max(it.value > 0 && upto === drawn ? 1 : 0, upto - drawn)
    bar.push({ text: '█'.repeat(len), color: color(k) })
    drawn += len
  })

  const out: Seg[][] = []
  if (title) out.push([{ text: clean(title), color: TITLE }])
  out.push(bar)
  items.forEach((it, k) => {
    out.push([
      { text: '■ ', color: color(k) },
      { text: pad(cut(it.label, labelW), labelW) },
      { text: ` ${((Math.max(0, it.value) / total) * 100).toFixed(1).padStart(5)}%  ` },
      { text: String(it.value), color: DIM },
    ])
  })
  return toArt(out)
}

// ---------------------------------------------------------------- mindmap

function mindText(raw: string): string {
  let s = raw.trim().replace(/:::.*$/, '').trim()
  const shapes: [RegExp, number][] = [
    [/^[^\s([{)]*\(\((.*)\)\)$/, 1],
    [/^[^\s([{)]*\)\)(.*)\(\($/, 1],
    [/^[^\s([{)]*\{\{(.*)\}\}$/, 1],
    [/^[^\s([{)]*\[(.*)\]$/, 1],
    [/^[^\s([{)]*\)(.*)\($/, 1],
    [/^[^\s([{)]*\((.*)\)$/, 1],
  ]
  for (const [re, g] of shapes) {
    const m = re.exec(s)
    if (m) {
      s = m[g]
      break
    }
  }
  return clean(unquote(s).replace(/`/g, '').replace(/\*\*/g, ''))
}

function renderMindmap(src: string): Art | null {
  const lines = srcLines(src).slice(1)
  type Node = { text: string; indent: number; kids: Node[] }
  const root: Node = { text: '', indent: -1, kids: [] }
  const stack: Node[] = [root]
  for (const raw of lines) {
    if (/^\s*::icon\(/.test(raw)) continue
    const indent = raw.length - raw.trimStart().length
    const node: Node = { text: mindText(raw), indent, kids: [] }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    stack[stack.length - 1].kids.push(node)
    stack.push(node)
  }
  if (!root.kids.length) return null
  const out: Seg[][] = []
  const walk = (n: Node, prefix: Seg[], color: string | undefined, isLast: boolean, top: boolean, branch: number) => {
    const c = top ? PALETTE[branch % PALETTE.length] : color
    if (prefix.length || !top) {
      out.push([...prefix, { text: isLast ? '└─ ' : '├─ ', color: c }, { text: n.text, color: c }])
    }
    const childPrefix = [...prefix, { text: isLast ? '   ' : '│  ', color: c }]
    n.kids.forEach((k, i) => walk(k, childPrefix, c, i === n.kids.length - 1, false, branch))
  }
  for (const r of root.kids) {
    out.push([{ text: `◉ ${r.text}`, color: TITLE }])
    r.kids.forEach((k, i) => {
      const c = PALETTE[i % PALETTE.length]
      const last = i === r.kids.length - 1
      out.push([{ text: last ? '└─ ' : '├─ ', color: c }, { text: k.text, color: c }])
      const pre: Seg[] = [{ text: last ? '   ' : '│  ', color: c }]
      k.kids.forEach((g, j) => walk(g, pre, c, j === k.kids.length - 1, false, i))
    })
  }
  return toArt(out)
}

// ---------------------------------------------------------------- timeline

function renderTimeline(src: string): Art | null {
  const lines = srcLines(src).slice(1)
  let title = ''
  type Period = { section: string; name: string; events: string[] }
  const periods: Period[] = []
  let section = ''
  for (const raw of lines) {
    const st = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(st))) title = clean(m[1])
    else if ((m = /^section\s+(.+)$/.exec(st))) section = clean(m[1])
    else if (st.startsWith(':')) {
      const p = periods[periods.length - 1]
      if (p) p.events.push(...st.split(':').map(clean).filter(Boolean))
    } else if (/^(accTitle|accDescr|direction)\b/.test(st)) continue
    else {
      const [name, ...evs] = st.split(':')
      periods.push({ section, name: clean(name), events: evs.map(clean).filter(Boolean) })
    }
  }
  if (!periods.length) return null
  const out: Seg[][] = []
  if (title) out.push([{ text: title, color: TITLE }])
  let lastSection = ''
  let si = -1
  periods.forEach((p, i) => {
    if (p.section && p.section !== lastSection) {
      lastSection = p.section
      si++
      out.push([{ text: `┈┈ ${p.section} ┈┈`, color: DIM }])
    }
    const c = PALETTE[(si >= 0 ? si : i) % PALETTE.length]
    const last = i === periods.length - 1
    out.push([{ text: '◆ ', color: c }, { text: p.name, color: c }])
    p.events.forEach(ev => out.push([{ text: last ? '  ' : '│ ', color: LINE }, { text: '  • ' + ev }]))
    if (!last) out.push([{ text: '│', color: LINE }])
  })
  return toArt(out)
}

// ---------------------------------------------------------------- entry

/** Draws the non-flowchart types; undefined when the source is not one of them. */
export function renderExtra(src: string, maxWidth: number): Art | null | undefined {
  const kind = diagramKind(src)
  try {
    if (kind === 'sequenceDiagram') return renderSequence(src, maxWidth)
    if (kind === 'gantt') return renderGantt(src, maxWidth)
    if (kind === 'pie') return renderPie(src, maxWidth)
    if (kind === 'mindmap') return renderMindmap(src)
    if (kind === 'timeline') return renderTimeline(src)
  } catch {
    return null
  }
  return undefined
}
