// Mermaid sequenceDiagram -> colored text art. Pure functions, no I/O.

import type { Art } from '../common'
import { PALETTE, DIM, ARROW, TITLE, strWidth, srcLines, clean, cut, TextCanvas } from '../common'

type SeqEv =
  | { kind: 'msg'; a: number; b: number; text: string; dotted: boolean; head: string }
  | { kind: 'note'; a: number; b: number; text: string }
  | { kind: 'block'; text: string }

export function renderSequence(src: string, maxWidth: number): Art | null {
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
  const cv = new TextCanvas(W)
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
