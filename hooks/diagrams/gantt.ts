// Mermaid gantt -> colored text bars. Pure functions, no I/O.

import type { Art, Seg } from '../common'
import { PALETTE, DIM, TITLE, strWidth, srcLines, clean, pad, cut, toArt } from '../common'

const UNIT: Record<string, number> = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, M: 2592e6, y: 31536e6 }

export function renderGantt(src: string, maxWidth: number): Art | null {
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
